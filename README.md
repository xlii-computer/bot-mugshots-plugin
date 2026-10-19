# Bot Mugshots (Cursor plugin)

Portable [Agent Plugin](https://agent-plugins.org/) for the keyless [Bot Mugshots](https://mugshots.bot) public API: deterministic SVG portraits, 100-bot lineups, and rap sheets from a roll name.

## What it does

- **MCP tools** call `https://mugshots.bot` (read-only, no API key).
- **Skill** (`skills/bot-mugshots/SKILL.md`) tells the agent when to use the tools, how to **take your mugshot's name** (adopt a generated alias), and never to fabricate mugshot data.

## Install

### From the Cursor Marketplace

After this plugin is published, install it from the Cursor plugin marketplace and reload the window.

### Local / dev (same layout as marketplace)

1. Clone this repository.
2. In Cursor, install the plugin from the repo root (or copy the repo into your local plugins directory per [Cursor plugin docs](https://cursor.com/docs/reference/plugins)).
3. Requires **Node.js 18+** (global `fetch`) on your machine for the bundled stdio MCP server.
4. Reload Cursor.

## MCP server

Configured in `mcp.json`: stdio server `node server/index.mjs` with plugin-relative `cwd` `./` (works from a marketplace install without `${PLUGIN_ROOT}`).

### Tools

| Tool | Description |
|------|-------------|
| `mugshot_portrait` | `{ name, i?, size?, ink?, fill?, pal?, line?, bg?, animate?, save_to? }` → SVG text, request URL, optional file under the plugin data directory |
| `mugshot_lineup` | `{ name, + render opts }` → compact list of 100 bots + `lineup.svg` URL |
| `mugshot_rap_sheet` | `{ name, i, + render opts }` → nickname, role, booking, `rapSheet`, traits summary, portrait URL |

Inputs are validated against `openapi.yaml` in this package before any HTTP call.

### API

- Base URL: `https://mugshots.bot`
- Reference: [API.md](https://mugshots.bot/api/API.md)
- Always `v=1` and header `X-Client-Id: grokbot-mugshots-plugin`
- Rate limit: **60 requests/minute** per IP and per client id. On **429**, tools return `retryAfter` — back off.

On **mugshots.bot**, trait tweaks on the booking desk show an **IN DISGUISE** badge locally; the API still returns the canonical seeded portrait for each `(name, i)` unless you replicate those traits yourself.

## Example prompts

- “Make a profile picture for my bot **TINKABOT**, slot 0.”
- “Show the lineup for roll name **BOTANO** and pick the funniest suspect.”
- “Pull the rap sheet for **TINKABOT** #44 and summarize the charges.”
- “**Take my mugshot's name** — use the alias from **BOTANO** slot 7 as my agent's display name.”
- “Export a chalk-style portrait, size 512, transparent background.”

## Validate locally

```bash
node scripts/validate-manifests.mjs
node scripts/smoke-stdio.mjs
```

`smoke-stdio.mjs` runs initialize, `tools/list`, and live `tools/call` against mugshots.bot.

## Generated artwork terms

Use of portraits and API output is governed by [Bot Mugshots Terms of Use](https://mugshots.bot/terms.html) ([markdown](https://mugshots.bot/TERMS.md)). Commercial use and profile pictures are allowed; attribution is appreciated but not required.

## License

This plugin repository is licensed under the [MIT License](LICENSE). The Mugshots generator and API remain under their own terms on [mugshots.bot](https://mugshots.bot).
