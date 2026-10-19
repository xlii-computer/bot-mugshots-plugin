/**
 * Parameter contract derived from plugin/openapi.yaml (must match repo root openapi.yaml).
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENAPI_PATH = join(__dirname, "..", "openapi.yaml");

/** Minimal YAML reader for components.parameters used by this API. */
function parseOpenApiParameters(yaml) {
  const params = {};
  const block = yaml.match(/^\s{2}parameters:\n([\s\S]*?)^\s{2}responses:/m);
  if (!block) throw new Error("openapi.yaml: missing components.parameters");
  const section = block[1];
  const chunks = ("\n" + section.trimEnd()).split(/\n    (\w+):\n/).slice(1);
  for (let k = 0; k < chunks.length; k += 2) {
    const key = chunks[k];
    const body = chunks[k + 1] || "";
    const param = { name: key };
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
    const typeMatch = body.match(/type:\s*(\w+)/);
    if (typeMatch) param.type = typeMatch[1];
    const defMatch = body.match(/default:\s*([^\n]+)/);
    if (defMatch) {
      const raw = defMatch[1].trim();
      if (raw === "true" || raw === "false") param.default = raw === "true";
      else if (/^\d+(\.\d+)?$/.test(raw)) param.default = Number(raw);
      else param.default = raw.replace(/^['"]|['"]$/g, "");
    }
    params[key] = param;
  }
  return params;
}

let _cached;
export function getContract() {
  if (_cached) return _cached;
  const yaml = readFileSync(OPENAPI_PATH, "utf8");
  const parameters = parseOpenApiParameters(yaml);
  _cached = {
    parameters,
    baseUrl: "https://mugshots.bot",
    apiVersion: 1,
    clientId: "grokbot-mugshots-plugin",
  };
  return _cached;
}

export function normalizeName(raw) {
  const v = String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return v || "BOTANO";
}

export function validateParam(name, value, param, { required = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) return { ok: false, error: `Missing required parameter: ${name}` };
    return { ok: true, value: param.default };
  }
  if (param.type === "integer") {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return { ok: false, error: `${name} must be an integer` };
    }
    if (param.minimum != null && n < param.minimum) {
      return { ok: false, error: `${name} must be >= ${param.minimum}` };
    }
    if (param.maximum != null && n > param.maximum) {
      return { ok: false, error: `${name} must be <= ${param.maximum}` };
    }
    if (param.enum && !param.enum.includes(String(n))) {
      return { ok: false, error: `${name} must be one of: ${param.enum.join(", ")}` };
    }
    return { ok: true, value: n };
  }
  if (param.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) return { ok: false, error: `${name} must be a number` };
    return { ok: true, value: n };
  }
  const s = String(value);
  if (param.enum && !param.enum.includes(s)) {
    return { ok: false, error: `${name} must be one of: ${param.enum.join(", ")}` };
  }
  if (name === "name") {
    const norm = normalizeName(s);
    if (!norm) return { ok: false, error: "name must contain at least one A-Z or 0-9 character" };
    return { ok: true, value: norm };
  }
  if (param.maxLength && s.length > param.maxLength) {
    return { ok: false, error: `${name} max length is ${param.maxLength}` };
  }
  return { ok: true, value: s };
}

export function buildQueryArgs(args, { portrait = false } = {}) {
  const { parameters } = getContract();
  const out = {};

  const vRes = validateParam("v", 1, parameters.v, { required: true });
  if (!vRes.ok) return vRes;
  out.v = vRes.value;

  const nameRes = validateParam("name", args.name ?? args.roll, parameters.name, { required: true });
  if (!nameRes.ok) return nameRes;
  out.name = nameRes.value;

  const keys = portrait
    ? ["pack", "i", "size", "ink", "fill", "pal", "line", "bg", "animate"]
    : ["pack", "ink", "fill", "pal", "line", "bg"];
  for (const key of keys) {
    const param = parameters[key];
    if (!param) continue;
    if (key === "i") {
      const iVal = args.i ?? args.index;
      const r = validateParam("i", iVal, param);
      if (!r.ok) return r;
      if (r.value !== undefined) out.i = r.value;
      continue;
    }
    if (key === "animate") {
      if (args.animate === true || args.animate === 1 || args.animate === "1") out.animate = "1";
      continue;
    }
    const r = validateParam(key, args[key], param);
    if (!r.ok) return r;
    if (r.value !== undefined) out[key] = r.value;
  }
  return { ok: true, query: out };
}

export function queryString(query) {
  const parts = [];
  for (const [k, v] of Object.entries(query)) {
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join("&");
}

export function toolDefinitions() {
  const { parameters: p } = getContract();
  const renderProps = {
    ink: { type: "string", enum: p.ink.enum, description: "Ink palette" },
    fill: { type: "string", enum: p.fill.enum, description: "Fill mode" },
    pal: { type: "string", enum: p.pal.enum, description: "Sticker palette" },
    line: { type: "number", description: "Stroke weight" },
    bg: { type: "string", enum: p.bg.enum, description: "Export background" },
  };
  return [
    {
      name: "mugshot_portrait",
      description:
        "Fetch one bot portrait as SVG for a roll name and index (0-99). Returns SVG text, request URL, and optional save_to path.",
      inputSchema: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string", description: "Roll name (A-Z0-9, max 12, normalized). Alias: roll." },
          roll: { type: "string", description: "Alias for name (site handoff label)." },
          i: { type: "integer", minimum: 0, maximum: 99, default: 0 },
          index: { type: "integer", minimum: 0, maximum: 99, description: "Alias for i." },
          size: { type: "integer", minimum: 64, maximum: 2048, default: 512 },
          animate: {
            type: "boolean",
            description: "Opt-in SMIL animation (sets animate=1; response may include X-Mugshot-Animate)",
            default: false,
          },
          ...renderProps,
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
          ...renderProps,
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
          ...renderProps,
        },
      },
    },
  ];
}
