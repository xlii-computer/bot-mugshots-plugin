#!/usr/bin/env node
/**
 * MCP stdio smoke test — plugin root as marketplace install (no PLUGIN_ROOT).
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function rpc(child, msg) {
  return new Promise((resolvePromise, reject) => {
    const onLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (parsed.id === msg.id) {
        child.stdout.off("data", onData);
        if (parsed.error) reject(new Error(parsed.error.message));
        else resolvePromise(parsed.result);
      }
    };
    const onData = (chunk) => {
      for (const line of String(chunk).split("\n")) onLine(line);
    };
    child.stdout.on("data", onData);
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  });
}

let nextId = 1;
function call(child, method, params) {
  const id = nextId++;
  return rpc(child, { jsonrpc: "2.0", id, method, params });
}

async function main() {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: PLUGIN_ROOT,
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env },
  });

  const init = await call(child, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.1.0" },
  });
  if (init.serverInfo?.name !== "bot-mugshots") {
    fail(`serverInfo.name expected bot-mugshots, got ${init.serverInfo?.name}`);
  }

  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );

  const list = await call(child, "tools/list", {});
  const names = (list.tools ?? []).map((t) => t.name).sort();
  const expected = ["mugshot_lineup", "mugshot_portrait", "mugshot_rap_sheet"].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    fail(`tools/list names mismatch: ${names.join(", ")}`);
  }

  const portrait = await call(child, "tools/call", {
    name: "mugshot_portrait",
    arguments: { name: "TINKABOT", i: 0, size: 256 },
  });
  const portraitPayload = JSON.parse(portrait.content[0].text);
  if (portraitPayload.xMugshotVersion !== "3") {
    fail(`xMugshotVersion expected 3, got ${portraitPayload.xMugshotVersion}`);
  }
  if (!portraitPayload.url?.startsWith("https://mugshots.bot/")) {
    fail("portrait url must be mugshots.bot");
  }
  if (!portraitPayload.svg?.includes("<svg")) {
    fail("portrait missing svg");
  }

  const res = await fetch(portraitPayload.url);
  const liveVersion = res.headers.get("x-mugshot-version");
  if (liveVersion !== "3") {
    fail(`live X-Mugshot-Version expected 3, got ${liveVersion}`);
  }

  const lineup = await call(child, "tools/call", {
    name: "mugshot_lineup",
    arguments: { name: "TINKABOT" },
  });
  const lineupPayload = JSON.parse(lineup.content[0].text);
  if (lineupPayload.count !== 100) {
    fail(`lineup count expected 100, got ${lineupPayload.count}`);
  }

  const rap = await call(child, "tools/call", {
    name: "mugshot_rap_sheet",
    arguments: { name: "TINKABOT", i: 0 },
  });
  const rapPayload = JSON.parse(rap.content[0].text);
  if (rapPayload.nickname !== "Diode") {
    fail(`rap sheet nickname expected Diode, got ${rapPayload.nickname}`);
  }

  child.kill();
  console.log("smoke-stdio: ok");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
