#!/usr/bin/env node
/**
 * Bot Mugshots MCP server (stdio, zero dependencies).
 */
import { createInterface } from "readline";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  getContract,
  buildQueryArgs,
  queryString,
  toolDefinitions,
  validateParam,
} from "./contract.mjs";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "bot-mugshots", version: "0.1.0" };

function envPath(key, fallback) {
  const v = process.env[key];
  return v && v.length ? v : fallback;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = envPath("PLUGIN_ROOT", join(__dirname, ".."));
const PLUGIN_DATA = envPath("PLUGIN_DATA", join(PLUGIN_ROOT, ".data"));

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function toolError(message, extra = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message, ...extra }, null, 2) }],
    isError: true,
  };
}

async function apiFetch(path, query) {
  const { baseUrl, clientId } = getContract();
  const url = `${baseUrl}${path}?${queryString({ v: 1, ...query })}`;
  const res = await fetch(url, {
    headers: { "X-Client-Id": clientId, Accept: "*/*" },
  });
  const version = res.headers.get("x-mugshot-version");
  if (res.status === 429) {
    let body = {};
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const retryAfter = body.retryAfter ?? res.headers.get("retry-after") ?? "unknown";
    throw Object.assign(new Error("rate_limit"), {
      code: 429,
      retryAfter,
      url,
    });
  }
  if (res.status >= 400) {
    let detail = await res.text();
    try {
      detail = JSON.stringify(JSON.parse(detail));
    } catch {
      /* plain text */
    }
    throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status, detail, url });
  }
  const body = await res.text();
  const animateVersion = res.headers.get("x-mugshot-animate");
  return { url, body, version, animateVersion, contentType: res.headers.get("content-type") || "" };
}

function traitsSummary(traits) {
  if (!traits || typeof traits !== "object") return {};
  const parts = [];
  for (const k of ["species", "kind", "head", "ears", "antenna", "hair", "hat", "eyewear", "outfit"]) {
    if (traits[k] != null) parts.push(`${k}=${traits[k]}`);
  }
  return { fields: parts.join(", "), species: traits.species, kind: traits.kind };
}

function saveRelative(relPath, text) {
  const base = resolve(PLUGIN_DATA);
  const target = resolve(PLUGIN_DATA, relPath);
  if (!target.startsWith(base + "/") && target !== base) {
    throw new Error("save_to must stay under PLUGIN_DATA");
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
  return target;
}

async function callTool(name, args) {
  const { parameters } = getContract();
  if (name === "mugshot_portrait") {
    const built = buildQueryArgs(args, { portrait: true });
    if (!built.ok) return toolError(built.error);
    const { url, body, version, animateVersion } = await apiFetch("/api/portrait", built.query);
    const payload = { url, xMugshotVersion: version, svg: body };
    if (animateVersion != null) payload.xMugshotAnimate = animateVersion;
    if (args.save_to) {
      try {
        payload.savedPath = saveRelative(args.save_to, body);
      } catch (e) {
        return toolError(e.message);
      }
    }
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "mugshot_lineup") {
    const built = buildQueryArgs(args);
    if (!built.ok) return toolError(built.error);
    const { url, body, version } = await apiFetch("/api/lineup", built.query);
    const data = JSON.parse(body);
    const lineupSvgUrl = `${getContract().baseUrl}/api/lineup.svg?${queryString(built.query)}`;
    const bots = (data.bots || []).map((b) => ({
      i: b.i,
      booking: b.booking,
      nickname: b.nickname,
      role: b.role,
      species: b.species,
      status: b.rapSheet?.status,
    }));
    const payload = {
      url,
      lineupSvgUrl,
      xMugshotVersion: version,
      v: data.v,
      generatorVersion: data.generatorVersion,
      name: data.name,
      count: data.count,
      bots,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  if (name === "mugshot_rap_sheet") {
    const iCheck = validateParam("i", args.i, parameters.i, { required: true });
    if (!iCheck.ok) return toolError(iCheck.error);
    const built = buildQueryArgs({ ...args, i: iCheck.value });
    if (!built.ok) return toolError(built.error);
    const { url, body, version } = await apiFetch("/api/lineup", built.query);
    const data = JSON.parse(body);
    const bot = (data.bots || []).find((b) => b.i === iCheck.value);
    if (!bot) return toolError(`No bot at index ${iCheck.value}`);
    const portraitUrl = `${getContract().baseUrl}/api/portrait?${queryString({
      ...built.query,
      i: iCheck.value,
      size: 512,
    })}`;
    const payload = {
      url,
      portraitUrl,
      xMugshotVersion: version,
      i: bot.i,
      nickname: bot.nickname,
      role: bot.role,
      booking: bot.booking,
      species: bot.species,
      rapSheet: bot.rapSheet,
      traitsSummary: traitsSummary(bot.traits),
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  }

  return toolError(`Unknown tool: ${name}`);
}

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    });
    return;
  }

  if (method === "notifications/initialized") {
    return;
  }

  if (method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id,
      result: { tools: toolDefinitions() },
    });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    Promise.resolve()
      .then(() => callTool(toolName, toolArgs))
      .then((result) => send({ jsonrpc: "2.0", id, result }))
      .catch((err) => {
        if (err.code === 429) {
          send({
            jsonrpc: "2.0",
            id,
            result: toolError("Rate limit exceeded", {
              retryAfter: err.retryAfter,
              url: err.url,
            }),
          });
          return;
        }
        send({
          jsonrpc: "2.0",
          id,
          result: toolError(err.message, { detail: err.detail, url: err.url }),
        });
      });
    return;
  }

  if (id !== undefined) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (Array.isArray(msg)) {
    for (const m of msg) handleRequest(m);
  } else {
    handleRequest(msg);
  }
});
