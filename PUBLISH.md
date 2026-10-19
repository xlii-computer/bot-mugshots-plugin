# Publishing to GitHub + Cursor Marketplace

This directory is the **complete public plugin** (repo root contents for `xlii-computer/bot-mugshots-plugin`).

## Create the public repo (Q)

```bash
cd plugin-public   # or copy these files to a fresh checkout
git init
git branch -M main
git add -A
git commit -m "Initial public Bot Mugshots Cursor plugin"
gh repo create xlii-computer/bot-mugshots-plugin --public --source=. --remote=origin --push
```

## Cursor marketplace

Submit **https://github.com/xlii-computer/bot-mugshots-plugin** at https://cursor.com/marketplace/publish

The Agent Plugins root manifest is `plugin.json`. Cursor marketplace logo: `assets/logo.svg` via `.cursor-plugin/plugin.json`.
