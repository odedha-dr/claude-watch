# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**claude-watch** is a CLI tool that monitors Claude Code sessions in real-time. It reads JSONL session logs from `~/.claude/projects/` and presents metrics (token usage, tool calls, compactions, agent spawns, skill invocations) via either a TUI dashboard or a web dashboard.

Installable via `npx claude-watch`.

## Commands

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in dev mode (no build step)
npx tsx src/index.ts

# Run with web dashboard
npx tsx src/index.ts --web --port 3000

# Run tests
npm test               # vitest run (single run)
npm run test:watch     # vitest (watch mode)

# Run a single test file
npx vitest run src/__tests__/parser.test.ts

# Build and run as binary
npm run build && node dist/index.js --help
```

## Architecture

```
src/
├── index.ts          # CLI entry (commander). Resolves project path, creates watcher, launches TUI or web mode
├── types.ts          # All shared TypeScript interfaces (RawEntry, SessionData, SubagentData, etc.)
├── parser.ts         # JSONL parser: parseEntry() extracts per-line metrics, parseSessionFile() aggregates a full session
├── discovery.ts      # Project/session discovery: scans ~/.claude/projects/ dirs, loads & sorts sessions
├── watcher.ts        # SessionWatcher (EventEmitter): chokidar file watching + 5s polling fallback, emits 'change' events
├── tui/
│   ├── app.ts        # blessed screen setup, layout, keybindings, watcher subscription
│   ├── sessions.ts   # Session list table widget (blessed-contrib)
│   └── detail.ts     # Detail panel: token breakdown, tool call bar chart, agents/skills
└── web/
    ├── server.ts     # Express server with SSE endpoint (/api/events) and REST (/api/sessions)
    └── public/
        └── index.html # Self-contained single-page dashboard (Pico CSS, EventSource, inline SVG charts)
```

### Data Flow

1. **discovery.ts** scans `~/.claude/projects/<project>/` for `.jsonl` files and subagent directories
2. **parser.ts** reads each JSONL file line-by-line, extracts token usage, tool calls, compactions, agent spawns, skill invocations
3. **watcher.ts** wraps discovery+parsing in a file-watching loop (chokidar + polling), emitting events on changes
4. **TUI or Web UI** subscribes to watcher events and re-renders

### Key Data Source Details

Session JSONL files are append-only logs at `~/.claude/projects/<project-dir>/<session-id>.jsonl`. Subagent logs live under `<session-id>/subagents/`. Important entry types:
- `assistant` messages carry `message.usage` (tokens) and `message.content` array (tool_use items)
- `system` entries with `subtype: "compact_boundary"` indicate context compactions
- Tool calls named `Agent` = agent spawns; `Skill` = skill invocations (skill name in `input.skill`)

## Tech Stack

- **Language**: TypeScript (ES2022, Node16 modules)
- **CLI**: commander
- **TUI**: blessed + blessed-contrib
- **Web**: Express + SSE (Server-Sent Events), Pico CSS
- **File watching**: chokidar
- **Testing**: vitest

## Design Documents

- `docs/plans/2026-03-11-claude-watch-design.md` — Full design spec with data model, UI layouts, CLI options
- `docs/plans/2026-03-11-claude-watch-implementation.md` — Step-by-step implementation plan (10 tasks)
