#!/usr/bin/env node
/**
 * bot-mugshots MCP server (stdio) — public https://mugshots.bot API only.
 */

import { createInterface } from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const SERVER_NAME = "bot-mugshots";
const SERVER_VERSION = "0.1.0";
const API_ORIGIN = "https://mugshots.bot";
const DEFAULTS = {
  v: 1,
  pack: "bots",
  ink: "chalk",
  fill: "sticker",
  pal: "candy",
  line: 1.25,
  bg: "none",
};

const TOOLS = [
  {
    name: "mugshot_portrait",
    description:
      "Fetch one bot portrait as SVG for a roll name and index (0-99). Returns SVG text, request URL, and optional save_to path.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: {
          type: "string",
          description: "Roll name (A-Z0-9, max 12, normalized). Alias: roll.",
        },
        roll: { type: "string", description: "Alias for name (site handoff label)." },
        i: { type: "integer", minimum: 0, maximum: 99, default: 0 },
        index: { type: "integer", minimum: 0, maximum: 99, description: "Alias for i." },
        size: { type: "integer", minimum: 64, maximum: 2048, default: 512 },
        animate: {
          type: "boolean",
          description:
            "Opt-in SMIL animation (sets animate=1; response may include X-Mugshot-Animate)",
          default: false,
        },
        ink: {
          type: "string",
          enum: ["ink", "chalk", "blueprint", "sodium", "paper"],
          description: "Ink palette",
        },
        fill: {
          type: "string",
          enum: ["sticker", "outline"],
          description: "Fill mode",
        },
        pal: {
          type: "string",
          enum: ["candy", "ocean", "retro", "pastel"],
          description: "Sticker palette",
        },
        line: { type: "number", description: "Stroke weight" },
        bg: {
          type: "string",
          enum: ["none", "transparent", "paper", "chalk", "light", "ink", "blueprint", "sodium"],
          description: "Export background",
        },
        save_to: {
          type: "string",
          description: "Optional relative path under PLUGIN_DATA to write the SVG file",
        },
      },
    },
  },
  {
    name: "mugshot_lineup",
    description:
      "List all 100 bots for a roll name (compact fields) plus the lineup.svg URL for the same render options.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        ink: {
          type: "string",
          enum: ["ink", "chalk", "blueprint", "sodium", "paper"],
          description: "Ink palette",
        },
        fill: {
          type: "string",
          enum: ["sticker", "outline"],
          description: "Fill mode",
        },
        pal: {
          type: "string",
          enum: ["candy", "ocean", "retro", "pastel"],
          description: "Sticker palette",
        },
        line: { type: "number", description: "Stroke weight" },
        bg: {
          type: "string",
          enum: ["none", "transparent", "paper", "chalk", "light", "ink", "blueprint", "sodium"],
          description: "Export background",
        },
      },
    },
  },
  {
    name: "mugshot_rap_sheet",
    description:
      "Return one bot from the lineup JSON: nickname, role, booking, rapSheet, traits summary, and portrait URL.",
    inputSchema: {
      type: "object",
      required: ["name", "i"],
      properties: {
        name: { type: "string" },
        i: { type: "integer", minimum: 0, maximum: 99 },
        ink: {
          type: "string",
          enum: ["ink", "chalk", "blueprint", "sodium", "paper"],
          description: "Ink palette",
        },
        fill: {
          type: "string",
          enum: ["sticker", "outline"],
          description: "Fill mode",
        },
        pal: {
          type: "string",
          enum: ["candy", "ocean", "retro", "pastel"],
          description: "Sticker palette",
        },
        line: { type: "number", description: "Stroke weight" },
        bg: {
          type: "string",
          enum: ["none", "transparent", "paper", "chalk", "light", "ink", "blueprint", "sodium"],
          description: "Export background",
        },
      },
    },
  },
];

function normalizeName(raw) {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return s.slice(0, 12);
}

function resolveIndex(args) {
  if (args.i !== undefined) return args.i;
  if (args.index !== undefined) return args.index;
  return 0;
}

function resolveRollName(args) {
  const raw = args.name ?? args.roll;
  const name = normalizeName(raw);
  if (!name) throw new Error("name is required (A-Z0-9, max 12)");
  return name;
}

function renderParams(args) {
  const out = {
    v: DEFAULTS.v,
    pack: DEFAULTS.pack,
    ink: args.ink ?? DEFAULTS.ink,
    fill: args.fill ?? DEFAULTS.fill,
    pal: args.pal ?? DEFAULTS.pal,
    line: args.line ?? DEFAULTS.line,
    bg: args.bg ?? DEFAULTS.bg,
  };
  return out;
}

function toQuery(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

function apiUrl(path, params) {
  return `${API_ORIGIN}${path}?${toQuery(params)}`;
}

async function fetchLineup(name, render) {
  const url = apiUrl("/api/lineup", { ...render, name });
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`lineup HTTP ${res.status} for ${url}`);
  }
  const version = res.headers.get("x-mugshot-version");
  const data = await res.json();
  return { url, data, xMugshotVersion: version };
}

function compactBot(bot) {
  const status = bot.rapSheet?.status ?? bot.status ?? "UNKNOWN";
  return {
    i: bot.i,
    booking: bot.booking,
    nickname: bot.nickname,
    role: bot.role,
    species: bot.species,
    status,
  };
}

function traitsSummary(traits) {
  if (!traits || typeof traits !== "object") {
    return { fields: "", species: "", kind: "" };
  }
  const order = [
    "species",
    "kind",
    "head",
    "ears",
    "antenna",
    "hair",
    "hat",
    "eyewear",
    "outfit",
  ];
  const fields = order
    .filter((k) => traits[k] !== undefined && traits[k] !== "none")
    .map((k) => `${k}=${traits[k]}`)
    .join(", ");
  return {
    fields,
    species: traits.species ?? "",
    kind: traits.kind ?? "",
  };
}

async function toolPortrait(args) {
  const name = resolveRollName(args);
  const i = resolveIndex(args);
  const size = args.size ?? 512;
  const render = renderParams(args);
  const params = { ...render, name, i, size };
  if (args.animate) params.animate = 1;
  const url = apiUrl("/api/portrait", params);
  const res = await fetch(url, { headers: { Accept: "image/svg+xml" } });
  if (!res.ok) throw new Error(`portrait HTTP ${res.status} for ${url}`);
  const svg = await res.text();
  const xMugshotVersion = res.headers.get("x-mugshot-version") ?? undefined;

  if (args.save_to) {
    const base = process.env.PLUGIN_DATA;
    if (!base) throw new Error("save_to requires PLUGIN_DATA");
    const rel = String(args.save_to).replace(/^\/+/, "");
    const dest = resolve(join(base, rel));
    if (!dest.startsWith(resolve(base))) throw new Error("save_to escapes PLUGIN_DATA");
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, svg, "utf8");
  }

  return { url, xMugshotVersion, svg };
}

async function toolLineup(args) {
  const name = resolveRollName(args);
  const render = renderParams(args);
  const { url, data, xMugshotVersion } = await fetchLineup(name, render);
  const lineupSvgUrl = apiUrl("/api/lineup.svg", { ...render, name });
  const bots = (data.bots ?? []).map(compactBot);
  return {
    url,
    lineupSvgUrl,
    xMugshotVersion,
    v: data.v,
    generatorVersion: data.generatorVersion,
    name: data.name ?? name,
    count: data.count ?? bots.length,
    bots,
  };
}

async function toolRapSheet(args) {
  const name = resolveRollName(args);
  const i = args.i;
  const render = renderParams(args);
  const { url, data, xMugshotVersion } = await fetchLineup(name, render);
  const bot = (data.bots ?? []).find((b) => b.i === i);
  if (!bot) throw new Error(`no bot at index ${i} for roll ${name}`);
  const portraitUrl = apiUrl("/api/portrait", {
    ...render,
    name,
    i,
    size: 512,
  });
  return {
    url,
    portraitUrl,
    xMugshotVersion,
    i: bot.i,
    nickname: bot.nickname,
    role: bot.role,
    booking: bot.booking,
    species: bot.species,
    rapSheet: bot.rapSheet,
    traitsSummary: traitsSummary(bot.traits),
  };
}

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

async function handleToolsCall(params) {
  const { name, arguments: args = {} } = params;
  try {
    if (name === "mugshot_portrait") return textResult(await toolPortrait(args));
    if (name === "mugshot_lineup") return textResult(await toolLineup(args));
    if (name === "mugshot_rap_sheet") return textResult(await toolRapSheet(args));
    return errorResult(`unknown tool: ${name}`);
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function main() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const { id, method, params } = req;
    if (method === "notifications/initialized" || id === undefined) {
      continue;
    }
    if (method === "initialize") {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
      continue;
    }
    if (method === "tools/list") {
      send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      continue;
    }
    if (method === "tools/call") {
      const result = await handleToolsCall(params ?? {});
      send({ jsonrpc: "2.0", id, result });
      continue;
    }
    send({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
