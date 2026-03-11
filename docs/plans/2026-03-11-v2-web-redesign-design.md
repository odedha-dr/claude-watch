# claude-watch v2: Web Dashboard Redesign

## Overview

Major redesign of the web dashboard from a simple table+detail view to a two-panel layout with sidebar navigation, dashboard widgets, time filters, session drill-down with tabs, and cost estimation. TUI remains as-is.

## Layout

```
┌──────────────────────────────────────────────────────────┐
│  claude-watch                                            │
├────────────────────┬─────────────────────────────────────┤
│  SIDEBAR (30%)     │  MAIN PANEL (70%)                   │
│                    │                                     │
│  [Today][7d][30d]  │  ┌─────────────────────────────────┐│
│                    │  │ Session: abc123                  ││
│  ┌──────────────┐  │  │                                 ││
│  │ Tokens: 1.2M │  │  │ [Overview] [Tools] [Subagents]  ││
│  │ Cost: $12.34 │  │  │ [Skills]                        ││
│  │ Active: 3    │  │  │                                 ││
│  └──────────────┘  │  │ ┌─────────────────────────────┐ ││
│                    │  │ │ Tab content here              │ ││
│  ▼ session-1       │  │ │                               │ ││
│    ~/proj/foo      │  │ │                               │ ││
│    opus · $2.34    │  │ │                               │ ││
│    ▶ Subagents (3) │  │ │                               │ ││
│    ▶ Skills (2)    │  │ │                               │ ││
│                    │  │ │                               │ ││
│  ▶ session-2       │  │ └─────────────────────────────┘ ││
│    ~/proj/bar      │  └─────────────────────────────────┘│
│    sonnet · $0.45  │                                     │
│                    │  (empty state when nothing selected) │
└────────────────────┴─────────────────────────────────────┘
```

## Sidebar

### Time Filter
- Three buttons: **Today**, **7 Days**, **30 Days**
- Filters session tree and recalculates summary widgets
- Default: Today

### Summary Widgets
- **Total Tokens**: sum of input + output across visible sessions
- **Total Cost**: calculated from model pricing
- **Active Sessions**: count active in last 30 min

### Session Tree
- Each session shows: truncated ID, folder (full `~/...` path), model short name, cost
- Expandable to show:
  - **Subagents** — with description extracted from `Agent` tool_use `input.description`
  - **Skills** — skill names from `Skill` tool_use `input.skill`
- Active sessions highlighted (green dot or similar)
- Sorted by last-active descending
- Clicking a session or child opens detail in main panel

## Main Panel — Session Detail Tabs

### Overview Tab
- **Header**: full session ID, model, folder, started time (absolute + relative), active status badge
- **Token breakdown table**: Input, Output, Cache Created, Cache Read, Total
- **Cost breakdown**: Input cost, Output cost, Total cost
- **Compactions**: count
- **Quick stats**: total tool calls, subagent count, skill count

### Tools Tab
- **Tool call timeline**: chronological list of tool calls with turn number; multi-tool turns grouped
- **Aggregated stats**: bar chart by tool name + top tool combinations (tools called together in same turn)
- **Per-turn breakdown**: table with Turn #, tools used, token usage per turn — sortable

### Subagents Tab
- **Summary bar**: total subagents, total subagent tokens, total subagent cost
- **Subagent list**: cards with description, model, token usage, cost, tool count — sorted by token usage desc
- **Subagent detail** (on click): mini-session view with token breakdown, cost, tool call chart

### Skills Tab
- **Skills list**: skill name, invocation count, turn number(s)
- **Skill detail** (on click): input arguments, which turn triggered it

## API Design

### Existing (lightweight, for sidebar/SSE)
- `GET /api/sessions` — returns `SessionSummary[]` (id, model, cwd, tokens in/out, cost, isActive, startedAt, subagentCount, skillNames)
- `GET /api/events` (SSE) — streams `SessionSummary[]` on change

### New (heavy, for drill-down)
- `GET /api/sessions/:id` — returns `SessionDetail`:
  ```typescript
  {
    ...SessionSummary,
    tokens: { input, output, cacheCreation, cacheRead },
    cost: { input, output, total },
    compactions: number,
    turns: Turn[],           // per-turn data
    toolCalls: ToolCallEntry[],  // chronological tool calls
    toolAggregates: { name: string, count: number }[],
    toolCombinations: { tools: string[], count: number }[],
    subagents: SubagentDetail[],
    skills: SkillInvocation[],
  }
  ```

### New Types

```typescript
interface Turn {
  number: number;
  role: 'user' | 'assistant';
  toolCalls: string[];       // tool names in this turn
  tokens: { input: number; output: number };
}

interface ToolCallEntry {
  name: string;
  turnNumber: number;
  input?: Record<string, unknown>;  // for Agent/Skill, extract key fields
}

interface SubagentDetail {
  id: string;
  description: string;      // from Agent tool_use input.description
  model: string;
  tokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
  cost: { input: number; output: number; total: number };
  toolCalls: Record<string, number>;
  toolCallTimeline: ToolCallEntry[];
}

interface SkillInvocation {
  name: string;
  turnNumber: number;
  args?: string;
  count: number;  // if grouped
}

interface SessionSummary {
  id: string;
  model: string;
  cwd: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  isActive: boolean;
  startedAt: string | null;
  subagentCount: number;
  skillNames: string[];
  subagentDescriptions: string[];  // for tree display
}
```

## Cost Estimation

Hardcoded pricing (per 1M tokens):

| Model | Input | Output | Cache Write | Cache Read |
|-------|-------|--------|-------------|------------|
| claude-opus-4-6 | $15.00 | $75.00 | $18.75 | $1.50 |
| claude-sonnet-4-6 | $3.00 | $15.00 | $3.75 | $0.30 |
| claude-haiku-4-5 | $0.80 | $4.00 | $1.00 | $0.08 |

Model matching: match on prefix (e.g., `claude-opus-4` matches `claude-opus-4-6-20250101`). Unknown models default to Sonnet pricing with a warning indicator.

## Parser Changes

Current `parseEntry()` returns flat metrics. For the detail view we need:

1. **Turn tracking**: assign turn numbers based on user/assistant message alternation
2. **Chronological tool calls**: collect `ToolCallEntry[]` in order
3. **Agent description extraction**: when tool_use name is `Agent`, extract `input.description` and `input.model`
4. **Skill args extraction**: when tool_use name is `Skill`, extract `input.skill` and `input.args`

Add a new `parseSessionFileDetailed()` function that returns `SessionDetail` (the rich type). The existing `parseSessionFile()` stays lean for the sidebar/SSE path.

## Tech Notes

- Web dashboard remains self-contained (single HTML file with inline CSS/JS)
- CSS Grid for the two-panel layout
- Tab switching is client-side (no routing)
- Detail data fetched via `fetch('/api/sessions/${id}')` on session click
- SSE continues to stream summary data for the sidebar
- No external JS dependencies (vanilla JS)
