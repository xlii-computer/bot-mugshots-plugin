# Bot Mugshots (Cursor plugin)

Agent Plugins 1.0 package that exposes [mugshots.bot](https://mugshots.bot) lineup, portrait, and rap-sheet data over MCP (stdio).

## Tools

- `mugshot_lineup` — compact list of 100 bots for a roll name plus lineup SVG URL
- `mugshot_portrait` — fetch one bot portrait SVG (optional `save_to` under `PLUGIN_DATA`)
- `mugshot_rap_sheet` — nickname, booking, charges, traits summary, and portrait URL for one index

All requests go to the public `https://mugshots.bot` API.

## Development

```bash
node scripts/validate-manifests.mjs
node scripts/smoke-stdio.mjs
```

Publish this repository at [Cursor Marketplace](https://cursor.com/marketplace/publish).
