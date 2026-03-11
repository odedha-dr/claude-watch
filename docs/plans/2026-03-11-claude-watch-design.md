# claude-watch - Design Document

**Date**: 2026-03-11
**Status**: Approved
**Author**: Oded Har-Tal

## Overview

A CLI tool that monitors Claude Code sessions in real-time, available as both a TUI (terminal dashboard) and a web app. Installable via `npx claude-watch`.

## CLI Interface

```bash
# TUI mode (default)
npx claude-watch

# Web mode
npx claude-watch --web [--port 3000]

# Options
--project <path>    # specific project dir (default: auto-detect from cwd)
--all               # monitor all projects
--port <number>     # web server port (default: 3000)
```

## Data Layer

- **Parser module** reads `~/.claude/projects/<project>/` JSONL files
- Extracts per-session: token usage (in/out/cache), compactions, tool calls, agent spawns, skill invocations, model, timestamps
- Aggregates subagent data from `<session>/subagents/*.jsonl`
- **Watcher** uses `chokidar` file watching on JSONL files + 5s polling fallback
- Emits events on data change - both TUI and web UI subscribe

## Data Sources

Session JSONL files located in `~/.claude/projects/<project-dir>/`:

- `<session-id>.jsonl` - main session log (append-only)
- `<session-id>/subagents/agent-*.jsonl` - subagent logs
- `~/.claude/history.jsonl` - cross-session index

### JSONL Entry Types

| Type | Description |
|------|-------------|
| `user` | User messages |
| `assistant` | Assistant messages (contain `message.usage` for tokens, `message.content` for tool_use) |
| `system` | System messages (`subtype: "compact_boundary"` = compaction) |
| `progress` | Hook progress, tool progress |
| `file-history-snapshot` | File tracking snapshots |

### Key Data Fields

- **Token usage**: `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`
- **Compactions**: entries with `type: "system"` and `subtype: "compact_boundary"`
- **Tool calls**: `tool_use` items in `message.content` array (assistant messages)
- **Agent spawns**: tool_use where `name == "Agent"`
- **Skill invocations**: tool_use where `name == "Skill"` (skill name in `input.skill`)
- **Model**: `message.model` field
- **Session ID**: `sessionId` field on every entry

## TUI Mode (default)

- Built with `blessed` + `blessed-contrib`
- Layout:
  - Session list table (top) with sortable columns: ID, started, model, tokens in/out, compactions, status
  - Detail panel (bottom): token stats, tool call bar chart, agent/skill list, token flow sparkline
- Keyboard: arrows, enter to select, q to quit, p to switch project, r to refresh, t to sort

## Web Mode (`--web`)

- Lightweight Express server
- Single HTML page with Pico CSS for clean styling
- Server-Sent Events (SSE) for live push updates
- Same layout as TUI: session table + detail panel
- Simple bar charts via inline SVG (zero JS chart dependencies)

## Project Structure

```
claude-watch/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # CLI entry point (commander)
│   ├── parser.ts         # JSONL parser & data extraction
│   ├── watcher.ts        # chokidar + polling, event emitter
│   ├── types.ts          # shared types
│   ├── tui/
│   │   ├── app.ts        # blessed screen setup
│   │   ├── sessions.ts   # session table widget
│   │   └── detail.ts     # detail panel widget
│   └── web/
│       ├── server.ts     # Express + SSE
│       └── public/
│           └── index.html # single-page dashboard
└── README.md
```

## Key Types

```typescript
interface SessionData {
  id: string;
  project: string;
  model: string;
  startedAt: Date;
  isActive: boolean;
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  compactions: number;
  toolCalls: Record<string, number>;
  agentSpawns: number;
  skillInvocations: string[];
  subagents: SubagentData[];
}

interface SubagentData {
  id: string;
  tokens: { input: number; output: number };
  toolCalls: Record<string, number>;
}
```

## Dependencies

- `commander` - CLI parsing
- `blessed` + `blessed-contrib` - TUI
- `express` - web server
- `chokidar` - cross-platform file watching

## Out of Scope (v1)

- Cost estimation (token pricing varies)
- Historical trends / persistence
- Authentication for web UI
- Multiple simultaneous project monitoring
