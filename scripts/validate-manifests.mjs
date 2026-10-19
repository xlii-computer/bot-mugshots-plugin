#!/usr/bin/env node
/**
 * Validate plugin.json and mcp.json against agent-plugins JSON schemas (fetch, zero npm deps).
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function validateValue(value, schema, path = "$") {
  const errors = [];
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
    return errors;
  }
  const t = schema.type;
  if (t && typeOf(value) !== t) {
    errors.push(`${path}: expected ${t}, got ${typeOf(value)}`);
    return errors;
  }
  if (t === "object" && schema.properties) {
    const allowed = new Set(Object.keys(schema.properties));
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!allowed.has(k)) errors.push(`${path}.${k}: additional property not allowed`);
      }
    }
    for (const [k, sub] of Object.entries(schema.properties)) {
      if (value[k] !== undefined) errors.push(...validateValue(value[k], sub, `${path}.${k}`));
    }
    if (schema.required) {
      for (const k of schema.required) {
        if (value[k] === undefined) errors.push(`${path}: missing required property ${k}`);
      }
    }
  }
  if (t === "array" && schema.items) {
    value.forEach((item, i) => errors.push(...validateValue(item, schema.items, `${path}[${i}]`)));
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: pattern mismatch`);
  }
  if (schema.minLength != null && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${path}: minLength`);
  }
  if (schema.maxLength != null && typeof value === "string" && value.length > schema.maxLength) {
    errors.push(`${path}: maxLength`);
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => validateValue(value, sub, path).length === 0);
    if (matches.length !== 1) errors.push(`${path}: oneOf failed (${matches.length} matches)`);
  }
  if (schema.$ref) {
    errors.push(`${path}: unresolved $ref ${schema.$ref}`);
  }
  return errors;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let cur = root;
  for (const p of parts) cur = cur[p];
  return cur;
}

function validateWithRefs(value, schema, root, path) {
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) return [`${path}: bad ref`];
    return validateWithRefs(value, target, root, path);
  }
  const errors = [];
  const t = schema.type;
  if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: const`);
  if (t && typeOf(value) !== t) errors.push(`${path}: type ${t}`);
  if (errors.length) return errors;

  if (t === "object") {
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        const sub = schema.properties?.[k];
        if (!sub && schema.additionalProperties?.properties === undefined) {
          if (!schema.properties?.[k]) errors.push(`${path}.${k}: extra`);
        }
      }
    }
    if (schema.propertyNames?.not?.enum) {
      for (const k of Object.keys(schema.properties || {})) {
        if (schema.propertyNames.not.enum.includes(k)) errors.push(`${path}: forbidden key ${k}`);
      }
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (value[k] !== undefined) errors.push(...validateWithRefs(value[k], sub, root, `${path}.${k}`));
      }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (!schema.properties?.[k]) {
          errors.push(...validateWithRefs(v, schema.additionalProperties, root, `${path}.${k}`));
        }
      }
    }
    if (schema.required) {
      for (const k of schema.required) {
        if (value[k] === undefined) errors.push(`${path}: missing ${k}`);
      }
    }
    if (schema.oneOf) {
      const opts = schema.oneOf.map((sub) => validateWithRefs(value, sub, root, path));
      const ok = opts.filter((e) => e.length === 0).length;
      if (ok !== 1) errors.push(`${path}: oneOf (${ok} valid)`);
    }
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: pattern`);
  }
  return errors;
}

async function main() {
  const pluginSchema = await fetchJson("https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  const mcpSchema = await fetchJson("https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");

  const plugin = JSON.parse(readFileSync(join(PLUGIN_ROOT, "plugin.json"), "utf8"));
  const mcp = JSON.parse(readFileSync(join(PLUGIN_ROOT, "mcp.json"), "utf8"));

  const pe = validateWithRefs(plugin, pluginSchema, pluginSchema, "plugin.json");
  const me = validateWithRefs(mcp, mcpSchema, mcpSchema, "mcp.json");

  if (pe.length) {
    console.error("plugin.json validation errors:");
    pe.forEach((e) => console.error(" ", e));
    process.exit(1);
  }
  console.log("plugin.json: VALID");

  if (me.length) {
    console.error("mcp.json validation errors:");
    me.forEach((e) => console.error(" ", e));
    process.exit(1);
  }
  console.log("mcp.json: VALID");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
