---
name: bot-mugshots
description: Generate bot profile pictures, lineups, and rap sheets from a roll name via the Bot Mugshots public API.
---

# Bot Mugshots

Use the **bot-mugshots** MCP tools when the user wants to:

- Make themselves or a bot a **profile picture** from a name (portrait SVG).
- **Show the lineup** for a roll name (100 bots).
- **Pull a rap sheet** for a specific bot index.
- **Take your mugshot's name** — rename their bot or adopt a suspect's booking-desk alias as their handle or display name.

## Rules

- **Never invent mugshot data.** Always call `mugshot_portrait`, `mugshot_lineup`, or `mugshot_rap_sheet`.
- The **mugshots.bot** desk can mark a suspect **IN DISGUISE** (local trait tweaks in the browser). The public API always returns the **canonical** seeded portrait for `(pack, roll, i)` — not the disguised mugshot unless the user applies those traits manually.
- Normalize roll names client-side: uppercase **A–Z** and **0–9** only, max **12** characters.
- Pass **`v=1`** (handled by the server). The plugin sends `X-Client-Id: grokbot-mugshots-plugin`.
- HTTP query aliases: **`roll` → `name`**, **`index` → `i`** (site “Send to your agent” handoff). Prefer canonical `name` / `i` in new URLs, e.g. `/api/portrait.png?name=BOTANO&i=44&v=1`.
- Unknown query keys on art endpoints return **400** `unknown_query_params`.
- On **429** responses, respect `retryAfter` and do not hammer the API (60 requests/min per IP and per client).

## Take your mugshot's name

When the user wants to **rename their bot**, **pick a suspect from a lineup**, or **use the generated alias as their handle** (profile name, agent name, Discord/Slack display name, etc.):

1. Confirm the **roll name** (`name`) and, if they already have a favorite slot, the index **`i`** (0–99). If they only give a vibe (“the chaotic one in my BOTANO lineup”), call `mugshot_lineup` and help them choose an `i`.
2. Call **`mugshot_rap_sheet`** for `(name, i)` (or read `nickname` / `fullName` from lineup data).
3. Present the canonical identity fields: **`nickname`** (street alias), **`rapSheet.alias`**, **`fullName`** when present on lineup entries, plus **booking** and **role** for context.
4. Ask which name they want to **adopt** — usually the **nickname** or **alias**, sometimes the full **“First "Alias" Family”** display name from the API.
5. Apply the rename only where the user controls the name (project config, bot metadata, README, package name suggestion, etc.). Do not claim you changed an external platform account unless they explicitly ask you to run a command or edit a file that does so.
6. Optionally regenerate **`mugshot_portrait`** for the same `(name, i)` so their new handle matches the portrait they are using.

## Data shape

- **Mugshot**: `{ name, i, booking, nickname, role, species, traits, rapSheet }` where `rapSheet` includes `alias`, `booking`, `charges[]`, `associates[]`, `whereabouts`, `witness`, `status`.
- **Portrait**: SVG string for `(name, i)` plus render options (`size`, `ink`, `fill`, `pal`, `line`, `bg`).
- **Lineup**: `{ v, generatorVersion, name, count: 100, bots: Mugshot[] }`.

## Render options (optional)

| Param | Values |
|-------|--------|
| `ink` | ink, chalk, blueprint, sodium, paper |
| `fill` | sticker, outline |
| `pal` | candy, ocean, retro, pastel |
| `line` | stroke weight (number) |
| `bg` | none, transparent, paper, chalk, light, ink, blueprint, sodium |
| `size` | 64–2048 (portrait only) |
| `i` | 0–99 |
