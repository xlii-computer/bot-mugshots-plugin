#!/usr/bin/env node
/**
 * Zero-dependency check: plugin contract matches repo openapi.yaml and server parseApiConfig rules.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getContract } from "../server/contract.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const REPO_OPENAPI = join(REPO_ROOT, "openapi.yaml");
const PLUGIN_OPENAPI = join(__dirname, "..", "openapi.yaml");
const MUGSHOTS_JS = join(REPO_ROOT, "gen", "mugshots.js");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("OK:", msg);
}

function parseYamlParameters(yaml) {
  const block = yaml.match(/^\s{2}parameters:\n([\s\S]*?)^\s{2}responses:/m);
  if (!block) throw new Error("missing components.parameters");
  const section = block[1];
  const params = {};
  const chunks = ("\n" + section.trimEnd()).split(/\n    (\w+):\n/).slice(1);
  for (let k = 0; k < chunks.length; k += 2) {
    const key = chunks[k];
    const body = chunks[k + 1] || "";
    const param = {};
    const enumMatch = body.match(/enum:\s*\[([^\]]+)\]/);
    if (enumMatch) {
      param.enum = enumMatch[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
    }
    const minMatch = body.match(/minimum:\s*(\d+)/);
    const maxMatch = body.match(/maximum:\s*(\d+)/);
    if (minMatch) param.minimum = Number(minMatch[1]);
    if (maxMatch) param.maximum = Number(maxMatch[1]);
    const maxLen = body.match(/maxLength:\s*(\d+)/);
    if (maxLen) param.maxLength = Number(maxLen[1]);
    params[key] = param;
  }
  return params;
}

function assertServerInkPalette(js, inkEnum) {
  for (const k of inkEnum) {
    if (k === "paper") {
      if (!js.includes('query.ink === "paper"')) fail('server must accept ink=paper (maps to chalk)');
      else ok("server accepts ink=paper");
      continue;
    }
    if (!js.includes(`${k}:{ink:`)) fail(`PALETTES missing ink key ${k}`);
    else ok(`PALETTES has ink key ${k}`);
  }
}

function setsEqual(a, b, label) {
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  if (sa !== sb) {
    fail(`${label}: expected [${sb}] got [${sa}]`);
    return false;
  }
  ok(label);
  return true;
}

function main() {
  const repoYaml = readFileSync(REPO_OPENAPI, "utf8");
  const pluginYaml = readFileSync(PLUGIN_OPENAPI, "utf8");
  if (repoYaml !== pluginYaml) {
    fail("plugin/openapi.yaml is not byte-identical to repo root openapi.yaml");
  } else {
    ok("plugin/openapi.yaml matches repo openapi.yaml");
  }

  const repoParams = parseYamlParameters(repoYaml);
  const pluginContract = getContract().parameters;

  for (const key of Object.keys(repoParams)) {
    const r = repoParams[key];
    const p = pluginContract[key];
    if (!p) {
      fail(`plugin contract missing parameter ${key}`);
      continue;
    }
    if (r.enum && !setsEqual(p.enum, r.enum, `param ${key} enum`)) continue;
    if (r.minimum != null && p.minimum !== r.minimum) fail(`param ${key} minimum`);
    else if (r.minimum != null) ok(`param ${key} minimum ${r.minimum}`);
    if (r.maximum != null && p.maximum !== r.maximum) fail(`param ${key} maximum`);
    else if (r.maximum != null) ok(`param ${key} maximum ${r.maximum}`);
    if (r.maxLength != null && p.maxLength !== r.maxLength) fail(`param ${key} maxLength`);
    else if (r.maxLength != null) ok(`param ${key} maxLength ${r.maxLength}`);
  }

  const mugJs = readFileSync(MUGSHOTS_JS, "utf8");
  assertServerInkPalette(mugJs, repoParams.ink.enum);
  for (const k of repoParams.pal.enum) {
    if (!mugJs.includes(`${k}:`)) fail(`STICKER_PALS missing pal key ${k} in mugshots.js`);
    else ok(`STICKER_PALS has pal key ${k}`);
  }
  setsEqual(["sticker", "outline"], repoParams.fill.enum, "fill enum");
  setsEqual(["1"], repoParams.v.enum, "v enum");

  if (repoParams.i.minimum !== 0 || repoParams.i.maximum !== 99) fail("i range in openapi");
  else ok("i range 0-99 (openapi)");

  if (repoParams.size.minimum !== 64 || repoParams.size.maximum !== 2048) fail("size range in openapi");
  else ok("size range 64-2048 (openapi)");

  const bgEnum = repoParams.bg.enum;
  const expectedBg = ["none", "transparent", "paper", "chalk", "light", "ink", "blueprint", "sodium"];
  setsEqual(bgEnum, expectedBg, "bg enum (openapi)");

  if (!mugJs.includes(".slice(0, 12)")) fail("normalizeRollName max 12 not found in mugshots.js");
  else ok("server name normalization max 12 chars");

  if (process.exitCode) {
    console.error("\ncheck-contract: FAILED");
    process.exit(1);
  }
  console.log("\ncheck-contract: PASSED");
}

main();
