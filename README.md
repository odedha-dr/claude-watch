# claude-watch

Live monitoring dashboard for Claude Code sessions. Reads session JSONL logs and displays real-time metrics in your terminal or browser.

## Quick Start

```bash
npx claude-watch
```

## Modes

### TUI (default)

Terminal dashboard with session list and detail panel. Navigate with arrow keys, `q` to quit, `r` to refresh.

```bash
npx claude-watch
```

### Web

Browser dashboard with live SSE updates.

```bash
npx claude-watch --web
npx claude-watch --web --port 8080
```

## Options

```
--web             Launch web dashboard instead of TUI
--port <number>   Web server port (default: 3000)
--project <path>  Specific ~/.claude/projects/ directory to monitor
--all             Monitor all projects
```

By default, claude-watch auto-detects the project matching your current working directory.

## What It Monitors

- **Token usage** — input, output, cache creation, cache read
- **Compactions** — context window compressions
- **Tool calls** — breakdown by tool name (Bash, Read, Edit, etc.)
- **Agent spawns** — subagent launches
- **Skill invocations** — which skills were used
- **Subagents** — token usage per subagent

## How It Works

Claude Code writes append-only JSONL session logs to `~/.claude/projects/<project>/`. claude-watch uses chokidar file watching with a polling fallback to detect changes and parse metrics from these files in real-time.

## License

MIT
