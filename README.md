# claude-watch

Live monitoring dashboard for Claude Code sessions. Reads session JSONL logs and displays real-time metrics including token usage, costs, tool calls, turn-by-turn conversation flow, and agent/skill graphs.

## Install & Run

```bash
npx @odedha/claude-watch
```

Opens a web dashboard at http://localhost:3000 monitoring all your Claude Code sessions.

### Global Install

```bash
npm install -g @odedha/claude-watch
claude-watch
```

### Options

```
--port <number>   Web server port (default: 3000)
--project <path>  Monitor a specific ~/.claude/projects/ directory
--all             Monitor all projects (default for web mode)
--tui             Launch terminal dashboard instead of web
```

### Examples

```bash
# Default: web dashboard on port 3000, all projects
npx claude-watch

# Custom port
npx claude-watch --port 8080

# Terminal UI mode (shows active sessions across all projects)
npx claude-watch --tui

# Monitor specific project only
npx claude-watch --project ~/.claude/projects/-Users-me-my-project
```

## Web Dashboard

Two-panel layout with a sidebar and drill-down detail view.

### Sidebar
- **Time filter** — Today / 7 Days / 30 Days (active sessions always shown)
- **Summary widgets** — total tokens, total cost, active session count
- **Session tree** — expandable list with model badge, folder, cost; subagents and skills as child nodes

### Session Detail Tabs

**Overview** — token/cost breakdown, compactions, quick stats

**Turns** — chronological turn-by-turn view with:
- Timestamps and latency per turn
- Token breakdown including cache (creation/read)
- Click to expand: full content (thinking, text, tool calls with input/output)

**Tools** — aggregated bar chart, tool combinations, and a filterable list of every tool call with input/output drill-down

**Subagents** — cards with description, model, tokens, cost; expandable for full detail

**Skills** — grouped skill invocations with turn numbers and arguments

**Flow** — graph visualization of agent spawns and skill invocations as a sequential flow diagram. Parallel agents (spawned in the same turn) appear side-by-side; sequential spawns flow top-to-bottom.

## TUI Dashboard

Terminal-based dashboard (`--tui`) with session table and detail panel.

- Shows active sessions across all projects by default
- **j/k** or arrows to navigate sessions
- **a** to toggle between active-only and all sessions
- **r** to refresh
- **q** to quit
- Detail panel shows token/cost breakdown, text-based tool call bars, agents, skills

## What It Monitors

- **Token usage** — input, output, cache creation, cache read
- **Cost estimation** — per-model pricing (Opus, Sonnet, Haiku)
- **Tool calls** — breakdown by tool, combinations, individual call details with results
- **Turns** — full conversation flow with latency and content
- **Compactions** — context window compressions
- **Subagents** — spawns with descriptions, per-agent token/tool breakdown
- **Skill invocations** — which skills were used and when
- **Flow graph** — visual DAG of agent and skill spawns per session

## How It Works

Claude Code writes append-only JSONL session logs to `~/.claude/projects/<project>/`. claude-watch uses chokidar file watching with a polling fallback to detect changes and parse metrics from these files in real-time. The web dashboard receives updates via Server-Sent Events (SSE).

## License

MIT
