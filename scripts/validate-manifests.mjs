#!/usr/bin/env node
/**
 * Agent Plugins 1.0 manifest checks for plugin.json + mcp.json.
 * Prints the marketplace smoke format:
 *   plugin.json: VALID
 *   mcp.json: VALID
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_VERSION = "1.0.0";
const PLUGIN_SCHEMA_URL = `https://agent-plugins.org/schemas/${SPEC_VERSION}/plugin.schema.json`;
const MCP_SCHEMA_URL = `https://agent-plugins.org/schemas/${SPEC_VERSION}/mcp.schema.json`;

const PLUGIN_ALLOWED_KEYS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);
const AUTHOR_ALLOWED_KEYS = new Set(["name", "email", "url"]);
const NAME_RE = /^[a-z0-9](?:[a-z0-9]|[-.](?=[a-z0-9])){0,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CWD_RE = /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/;

let failed = false;

function fail(label, detail) {
  console.log(`${label}: INVALID`);
  if (detail) console.error(detail);
  failed = true;
}

function loadJson(rel) {
  return JSON.parse(readFileSync(join(PLUGIN_ROOT, rel), "utf8"));
}

function validatePlugin() {
  const label = "plugin.json";
  try {
    const manifest = loadJson("plugin.json");
    if (manifest.$schema !== PLUGIN_SCHEMA_URL) {
      fail(label, `expected $schema ${PLUGIN_SCHEMA_URL}`);
      return;
    }
    if (typeof manifest.name !== "string" || !NAME_RE.test(manifest.name)) {
      fail(label, "invalid name");
      return;
    }
    if (/--|\.\./.test(manifest.name)) {
      fail(label, "name has consecutive separators");
      return;
    }
    for (const key of Object.keys(manifest)) {
      if (!PLUGIN_ALLOWED_KEYS.has(key)) {
        fail(label, `unknown root field: ${key}`);
        return;
      }
    }
    if (manifest.version !== undefined && !SEMVER_RE.test(manifest.version)) {
      fail(label, "version must be semver");
      return;
    }
    if (manifest.author) {
      for (const key of Object.keys(manifest.author)) {
        if (!AUTHOR_ALLOWED_KEYS.has(key)) {
          fail(label, `unknown author field: ${key}`);
          return;
        }
      }
      if (typeof manifest.author.name !== "string") {
        fail(label, "author.name required");
        return;
      }
    }
    if (manifest.keywords) {
      for (const kw of manifest.keywords) {
        if (typeof kw !== "string") {
          fail(label, "keywords must be strings");
          return;
        }
      }
    }
    const body = JSON.stringify(manifest);
    if (body.includes("xlii-code.com")) {
      fail(label, "must not reference xlii-code.com");
      return;
    }
    console.log(`${label}: VALID (agent-plugins.org schema ${SPEC_VERSION})`);
  } catch (err) {
    fail(label, err instanceof Error ? err.message : String(err));
  }
}

function expandPluginRoot(value) {
  return String(value).replaceAll("${PLUGIN_ROOT}", PLUGIN_ROOT);
}

function validateMcp() {
  const label = "mcp.json";
  try {
    const mcp = loadJson("mcp.json");
    if (mcp.$schema !== MCP_SCHEMA_URL) {
      fail(label, `expected $schema ${MCP_SCHEMA_URL}`);
      return;
    }
    for (const key of Object.keys(mcp)) {
      if (key !== "$schema" && key !== "mcpServers") {
        fail(label, `unknown root field: ${key}`);
        return;
      }
    }
    if (!mcp.mcpServers || typeof mcp.mcpServers !== "object") {
      fail(label, "mcpServers object required");
      return;
    }
    for (const [serverName, server] of Object.entries(mcp.mcpServers)) {
      if (server.type !== "stdio") {
        fail(label, `server ${serverName}: only stdio supported in this bundle`);
        return;
      }
      if (typeof server.command !== "string" || /\s/.test(server.command)) {
        fail(label, `server ${serverName}: command must be a single token`);
        return;
      }
      if (server.command.includes("${")) {
        fail(label, `server ${serverName}: placeholders not allowed in command`);
        return;
      }
      if (server.cwd !== undefined) {
        if (!CWD_RE.test(server.cwd)) {
          fail(label, `server ${serverName}: invalid cwd`);
          return;
        }
        if (server.cwd.includes("${PLUGIN_ROOT}") || server.cwd.includes("${PLUGIN_DATA}")) {
          fail(label, `server ${serverName}: cwd must be ./ for marketplace install`);
          return;
        }
      }
      if (server.env) {
        for (const key of Object.keys(server.env)) {
          if (key === "PLUGIN_ROOT" || key === "PLUGIN_DATA") {
            fail(label, `server ${serverName}: env must not set ${key}`);
            return;
          }
        }
      }
      const cwd = server.cwd === "./" ? PLUGIN_ROOT : PLUGIN_ROOT;
      for (const arg of server.args ?? []) {
        const expanded = resolve(cwd, expandPluginRoot(arg));
        if (!expanded.startsWith(PLUGIN_ROOT + sep) && expanded !== PLUGIN_ROOT) {
          fail(label, `server ${serverName}: arg escapes plugin root: ${arg}`);
          return;
        }
        if (!existsSync(expanded)) {
          fail(label, `server ${serverName}: missing file ${arg}`);
          return;
        }
      }
    }
    const raw = readFileSync(join(PLUGIN_ROOT, "mcp.json"), "utf8");
    if (raw.includes("${PLUGIN_ROOT}") || raw.includes("PLUGIN_ROOT")) {
      fail(label, "must not use ${PLUGIN_ROOT}");
      return;
    }
    if (raw.includes("xlii-code.com")) {
      fail(label, "must not reference xlii-code.com");
      return;
    }
    console.log(`${label}: VALID (cwd \`./\`, no \`\${PLUGIN_ROOT}\`)`);
  } catch (err) {
    fail(label, err instanceof Error ? err.message : String(err));
  }
}

function validateNoPrivateLinks() {
  const scan = ["plugin.json", "mcp.json", "README.md", "server/index.mjs"];
  for (const rel of scan) {
    const src = readFileSync(join(PLUGIN_ROOT, rel), "utf8");
    if (/\bxlii-code\.com\b/.test(src)) {
      fail(rel, "must not reference xlii-code.com");
    }
  }
}

validatePlugin();
validateMcp();
validateNoPrivateLinks();

if (failed) process.exit(1);
