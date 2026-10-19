#!/usr/bin/env node
/**
 * Live stdio smoke: initialize, tools/list, tools/call x3 against mugshots.bot (TINKABOT).
 */
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "server", "index.mjs");
const ARTIFACTS = "/opt/cursor/artifacts";

let nextId = 1;
const pending = new Map();
const transcript = [];

function log(line) {
  const s = typeof line === "string" ? line : JSON.stringify(line);
  transcript.push(s);
  console.log(s);
}

function send(child, msg) {
  log({ direction: "client", msg });
  child.stdin.write(JSON.stringify(msg) + "\n");
}

function trimResult(obj) {
  if (!obj?.result?.content?.[0]?.text) return obj;
  try {
    const parsed = JSON.parse(obj.result.content[0].text);
    const copy = { ...obj, result: { ...obj.result } };
    if (parsed.svg && parsed.svg.length > 200) {
      parsed.svg = parsed.svg.slice(0, 120) + `… (${parsed.svg.length} chars)`;
      copy.result.content[0].text = JSON.stringify(parsed, null, 2);
    }
    return copy;
  } catch {
    return obj;
  }
}

async function main() {
  const pluginRoot = join(__dirname, "..");
  const child = spawn("node", ["server/index.mjs"], {
    cwd: pluginRoot,
    env: { ...process.env },
    stdio: ["pipe", "pipe", "inherit"],
  });

  child.stdout.on("data", (buf) => {
    for (const line of buf.toString().split("\n")) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      log({ direction: "server", msg: trimResult(msg) });
      const { id, result } = msg;
      if (id && pending.has(id)) {
        pending.get(id)(result);
        pending.delete(id);
      }
    }
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      send(child, { jsonrpc: "2.0", id, method, params });
    });
  }

  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.1.0" },
  });
  if (!init?.serverInfo?.name) throw new Error("initialize failed");

  send(child, { jsonrpc: "2.0", method: "notifications/initialized" });

  const tools = await request("tools/list", {});
  const names = (tools?.tools || []).map((t) => t.name).sort();
  log({ toolNames: names });
  if (names.join() !== "mugshot_lineup,mugshot_portrait,mugshot_rap_sheet") {
    throw new Error("unexpected tools/list");
  }

  const portrait = await request("tools/call", {
    name: "mugshot_portrait",
    arguments: { name: "TINKABOT", i: 0, size: 256 },
  });
  const portraitText = portrait?.content?.[0]?.text;
  const portraitJson = JSON.parse(portraitText);
  if (!portraitJson.xMugshotVersion) throw new Error("missing X-Mugshot-Version in portrait response");
  log({ xMugshotVersionPortrait: portraitJson.xMugshotVersion });

  mkdirSync(ARTIFACTS, { recursive: true });
  const fullPortrait = await fetch(portraitJson.url, {
    headers: { "X-Client-Id": "grokbot-mugshots-plugin" },
  });
  const svg = await fullPortrait.text();
  const verHdr = fullPortrait.headers.get("x-mugshot-version");
  log({ liveHeaderXMugshotVersion: verHdr });
  writeFileSync(join(ARTIFACTS, "tinkabot-i0-portrait.svg"), svg, "utf8");

  await request("tools/call", { name: "mugshot_lineup", arguments: { name: "TINKABOT" } });
  await request("tools/call", { name: "mugshot_rap_sheet", arguments: { name: "TINKABOT", i: 0 } });

  writeFileSync(join(ARTIFACTS, "smoke-transcript.jsonl"), transcript.join("\n") + "\n", "utf8");

  child.stdin.end();
  child.kill();
  console.log("\nsmoke-stdio: PASSED");
}

main().catch((e) => {
  console.error("smoke-stdio: FAILED", e);
  process.exit(1);
});
