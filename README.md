# claude-watch

Live monitoring dashboard for Claude Code sessions. Reads session JSONL logs and displays real-time metrics including token usage, costs, tool calls, and turn-by-turn conversation flow.

## Install & Run

```bash
npx claude-watch
```

Opens a web dashboard at http://localhost:3000 monitoring all your Claude Code sessions.

### Options

```
--port <number>   Web server port (default: 3000)
--project <path>  Monitor a specific ~/.claude/projects/ directory
--tui             Launch terminal dashboard instead of web
```

### Examples

```bash
# Default: web dashboard on port 3000, all projects
npx claude-watch

# Custom port
npx claude-watch --port 8080

# Terminal UI mode
npx claude-watch --tui

# Monitor specific project only
npx claude-watch --project ~/.claude/projects/-Users-me-my-project
```

## Dashboard

Two-panel web dashboard with a sidebar and drill-down detail view.

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

## What It Monitors

- **Token usage** — input, output, cache creation, cache read
- **Cost estimation** — per-model pricing (Opus, Sonnet, Haiku)
- **Tool calls** — breakdown by tool, combinations, individual call details with results
- **Turns** — full conversation flow with latency and content
- **Compactions** — context window compressions
- **Subagents** — spawns with descriptions, per-agent token/tool breakdown
- **Skill invocations** — which skills were used and when

## How It Works

Claude Code writes append-only JSONL session logs to `~/.claude/projects/<project>/`. claude-watch uses chokidar file watching with a polling fallback to detect changes and parse metrics from these files in real-time. The web dashboard receives updates via Server-Sent Events (SSE).

## License

MIT
