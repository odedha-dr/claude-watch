# claude-watch v2: Implementation Plan

Based on [v2 Web Redesign Design](./2026-03-11-v2-web-redesign-design.md).

## Task 1: Cost Module

**Files**: `src/cost.ts`, `src/__tests__/cost.test.ts`

Create a cost calculation module:
- Export `MODEL_PRICING` map with per-model rates (input, output, cache_write, cache_read per 1M tokens)
- Export `calculateCost(model: string, tokens: TokenUsage): CostBreakdown` — matches model prefix, returns `{ input, output, cacheWrite, cacheRead, total }`
- Unknown models default to Sonnet pricing
- Tests: known model, unknown model, zero tokens, cache-heavy session

## Task 2: Enhanced Parser — Turn Tracking & Tool Timeline

**Files**: `src/parser.ts`, `src/types.ts`, `src/__tests__/parser.test.ts`

Add new types: `Turn`, `ToolCallEntry`, `SkillInvocation`, `SubagentSpawn`, `SessionDetail`, `SessionSummary`.

Add `parseSessionFileDetailed(filePath, project)` function:
- Track turn numbers (increment on user→assistant transitions)
- Collect `ToolCallEntry[]` chronologically (tool name, turn number, key inputs)
- Extract Agent spawns with `input.description` and `input.model`
- Extract Skill invocations with `input.skill` and `input.args`
- Compute tool combinations (tools co-occurring in same assistant message)
- Include cost calculation using the cost module
- Return `SessionDetail` type

Keep existing `parseSessionFile()` but add cost and summary fields to make it return data suitable for `SessionSummary`.

Update test fixture with multi-turn data (user messages interleaved with assistant messages containing multiple tool calls).

Tests: turn numbering, tool timeline order, agent description extraction, skill args extraction, tool combinations, cost calculation integration.

## Task 3: API Enhancement — Session Detail Endpoint

**Files**: `src/web/server.ts`, `src/watcher.ts`, `src/discovery.ts`

Add `GET /api/sessions/:id` endpoint:
- Watcher stores the file path for each session (add to `SessionData`)
- Endpoint calls `parseSessionFileDetailed()` on demand for the requested session
- Returns full `SessionDetail` JSON
- Includes subagent detail: for each subagent, also call `parseSessionFileDetailed()` on its JSONL

Update SSE `/api/events` to stream `SessionSummary[]` instead of full `SessionData[]`:
- Include: id, model, cwd, tokensIn, tokensOut, cost, isActive, startedAt, subagentCount, skillNames, subagentDescriptions

Add watcher method to look up a session's file path by ID.

## Task 4: Web Dashboard — Layout Shell & Sidebar

**Files**: `src/web/public/index.html`

Replace the current HTML with the new two-panel layout:

**Sidebar (left, 30%)**:
- Time filter buttons (Today / 7d / 30d)
- Summary widget cards (tokens, cost, active count)
- Session tree (collapsible items)
- Active session indicator (green dot)

**Main panel (right, 70%)**:
- Empty state when nothing selected
- Tab bar (Overview / Tools / Subagents / Skills)
- Tab content area

CSS Grid layout. Dark theme (keep current color scheme). Responsive — sidebar collapses on narrow screens.

Wire up SSE to populate sidebar summary and session tree. Clicking a session fetches `/api/sessions/:id` and renders the Overview tab.

## Task 5: Web Dashboard — Overview Tab

**Files**: `src/web/public/index.html`

Render when a session is selected:
- Header with full session ID, model badge, folder path, started time (absolute + "2h ago"), active/inactive badge
- Token breakdown table (Input, Output, Cache Created, Cache Read, Total)
- Cost breakdown table (Input cost, Output cost, Total cost) — formatted as `$X.XX`
- Compaction count
- Quick stats row: total tool calls, subagent count, skill count

## Task 6: Web Dashboard — Tools Tab

**Files**: `src/web/public/index.html`

Three sections:
1. **Timeline**: scrollable list of tool calls in order. Group multi-tool turns. Show turn number.
2. **Aggregated chart**: horizontal bar chart of tool usage. Below it, top 5 tool combinations.
3. **Per-turn table**: Turn #, Tools, Tokens In, Tokens Out. Sortable columns (click header to sort).

## Task 7: Web Dashboard — Subagents Tab

**Files**: `src/web/public/index.html`

- Summary bar: total subagents, total tokens, total cost
- Card grid: each subagent as a card showing description, model, tokens, cost, top tools
- Click a card → expand inline with full detail: token breakdown, cost breakdown, tool bar chart, tool timeline
- Sort cards by: tokens (default), cost, tool calls

## Task 8: Web Dashboard — Skills Tab

**Files**: `src/web/public/index.html`

- Skills grouped by name with invocation count
- Each shows: skill name, count, turn numbers where invoked
- Click to expand: show `args` if present

## Task 9: Session Tree — Expandable Subagents & Skills

**Files**: `src/web/public/index.html`

Enhance the sidebar session tree:
- Expand/collapse arrow on each session
- Expanded view shows:
  - Subagent child nodes (description text, token summary)
  - Skill child nodes (skill name, count)
- Clicking a subagent in the tree opens the Subagents tab with that subagent pre-selected
- Clicking a skill in the tree opens the Skills tab

## Task 10: Polish & Testing

- Verify SSE updates refresh sidebar without losing selection state
- Verify time filter correctly filters sessions and recalculates widgets
- Verify detail fetch doesn't block SSE stream
- Test with large sessions (1000+ tool calls)
- Verify TUI still works unchanged
- Update README with new web dashboard screenshots/description
- Build verification: `npm run build && node dist/index.js --web`

## Execution Order

**Batch 1** (data layer): Tasks 1, 2 — can be parallel
**Batch 2** (API): Task 3 — depends on 1, 2
**Batch 3** (UI shell): Task 4 — depends on 3
**Batch 4** (UI tabs): Tasks 5, 6, 7, 8 — can be parallel, depend on 4
**Batch 5** (tree + polish): Tasks 9, 10 — depend on all above
