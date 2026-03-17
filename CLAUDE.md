# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

OSL Deal Scout is a zero-dependency Node.js tool for cryptocurrency exchange BD (Business Development) teams. It discovers, scores, and summarizes crypto project leads from Google News RSS feeds, with a web dashboard and Telegram notification support. Target audience is compliance-focused exchanges operating in Hong Kong.

## Commands

```bash
npm start          # Start the web dashboard server on port 3000
npm run digest     # Run the lead discovery pipeline from CLI
npm run check      # Syntax check all main JS files (node --check)

# Force push a digest to Telegram
node run-digest.js --push
```

There is no build step and no test framework — this project has zero npm dependencies.

## Architecture

This is a **flat-file pipeline** with a web dashboard:

- **`server.js`** — Standalone HTTP server (Node built-in `http` module). Serves the dashboard UI from `public/` and exposes REST API endpoints for projects, run history, and config. No framework.
- **`run-digest.js`** — CLI entry point for automation. Invokes the engine and optionally pushes results to Telegram.
- **`lib/engine.js`** — Core logic: fetches Google News RSS feeds, parses XML with regex (no third-party parser), extracts project names and signals, applies scoring weights, and formats output as HTML (dashboard) or Markdown (Telegram).
- **`lib/store.js`** — Thin persistence wrapper around synchronous `fs` reads/writes to the `data/` directory.
- **`public/app.js`** + **`public/styles.css`** — Vanilla JS/CSS frontend for the dashboard.

### Data / Config (the `data/` directory acts as the database)

| File | Purpose |
|---|---|
| `data/config.json` | Telegram bot credentials, scoring weights (e.g. `funding: 3`), filters |
| `data/sources.json` | Google News RSS search queries used for lead discovery |
| `data/projects.json` | Currently discovered leads |
| `data/run-history.json` | Pipeline execution logs |
| `data/project-rules.json` | Whitelist/blacklist for project name extraction accuracy |
| `data/internal-screening-rules.json` | Scoring heuristics for strategic fit |

### Key Design Constraints

- **No npm dependencies** — everything uses Node.js built-ins (`http`, `fs`, `fetch`). Node v18+ required for built-in `fetch`.
- Signals and scoring are regex-based and driven entirely by `data/config.json` weights.
- All persistence is via synchronous `fs` calls in `store.js`.
