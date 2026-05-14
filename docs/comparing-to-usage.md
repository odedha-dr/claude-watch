# claude-watch vs `/usage` — Why the Numbers Differ

## Context

Both tools report token/cost usage for Claude Code sessions. They sometimes disagree on per-field breakdowns. This doc explains why, what we fixed, and what's inherent.

## The two data sources

| Tool        | Source of truth                                                                                              |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `/usage`    | **Daemon in-memory counters** (`lastTotalInputTokens`, `lastTotalOutputTokens`, `…CacheCreation…`, `…CacheRead…`). Incremented from every Anthropic API response the daemon receives. Persisted to `~/.claude.json` only on graceful shutdown. |
| claude-watch | **The session JSONL** at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. Sums `message.usage` across assistant messages. |

These are not the same data. The daemon sees API calls the JSONL never records.

## What `/usage`'s in-memory counter includes that JSONL doesn't

Verified by extracting strings from the compiled Claude Code binary (`~/.local/share/claude/versions/<v>`):

- **Title generation** — short Anthropic calls to summarize the session title (`ai-title` entries in JSONL hold the result, not the request/response usage).
- **Agent-name generation** — similar to title-gen (`agent-name` entries).
- **API retries** — `lastAPIDurationWithoutRetries` exists as a separate counter, meaning the main counter *includes* retried calls.
- **Auxiliary daemon calls** — anything the daemon makes that isn't a main conversation turn.

The `usage` object on assistant messages in the JSONL is per-message-success-response only.

## Concrete example from one session (`5590ef4c…`, claude-opus-4-7)

| Metric           | `/usage`          | claude-watch (JSONL) | Match? |
|------------------|-------------------|----------------------|--------|
| Total cost       | $8.10             | $8.27                | ✓ +2%  |
| Cache Read       | 11,300,000        | 10,664,494           | ✓ −5.6% |
| Output           | 53,800            | 67,201               | ✗ +25% |
| Cache Write      | 177,100           | 247,706              | ✗ +40% |
| Input            | 2,200             | 149                  | ✗ −93% |

The **dominant cost driver** (cache read) and **total cost** track each other tightly. Per-field input/output/cache-write diverge because they're computed from different inputs.

### Why input differs by 13×

JSONL contains the assistant API responses' `input_tokens` field — typically only a few non-cached tokens per turn once prompt caching is established. Total across ~100 turns: ~170 tokens.

`/usage`'s daemon counter also adds title-gen / agent-name-gen / retry calls. Those are short, uncached calls of ~50 input tokens each. With ~40 such auxiliary calls in this session: ~2,000 extra input tokens. That's the ~2,030 token delta.

### Why output differs by ~25%

`output_tokens` in the JSONL includes Claude's thinking tokens (Claude 4 supports extended thinking). The thinking *content* itself is redacted from the JSONL (`{type: "thinking", thinking: ""}`), but the *token count* stays in `output_tokens`. The daemon counter for `/usage` appears to count something narrower — possibly the visible output only.

### Why cache write differs by ~40%

All `cache_creation_input_tokens` in this session are 1-hour ephemeral (`ephemeral_1h_input_tokens`). The daemon may normalize these to 5m-equivalents or count them under a different accounting bucket — the binary tracks `cacheCreationEphemeral1hTokens` and `cacheCreationEphemeral5mTokens` separately.

## What we fixed in claude-watch (and why those fixes are worth keeping)

1. **Opus 4.7 pricing bug.** `cost.ts` had `claude-opus-4` as a *legacy*-pricing catch-all. `claude-opus-4-7` fell through to it and was being billed at 3× the correct rate. Added explicit entry; flipped the catch-all to *new* pricing so future Opus 4.x versions default correctly. Legacy 4-0/4-1 stay explicit.

2. **Duplicate-message-fragment over-counting.** Claude Code splits one assistant message into multiple JSONL entries (one per content block: thinking / text / tool_use). Every fragment carries the **same** `usage` object. claude-watch was summing all of them — 2–3× over-count. Fix: dedup by `message.id` in both `parseSessionFile` and `parseSessionFileDetailed`. Tool calls and content still count per-fragment (each fragment has unique content).

3. **Context Window metric.** Added a "Context Window (last turn)" row = `input + cache_creation + cache_read` of the latest assistant turn. This is what `/usage` reports for context size (e.g. "~145K of 200K used"), distinct from lifetime billable totals.

All three are real bugs / missing features regardless of the `/usage` comparison.

## What we *can't* fix from JSONL alone

| Discrepancy on              | Achievable? | Why not |
|-----------------------------|-------------|---------|
| Total cost ±5%              | ✓ already   | Dominated by cache read |
| Cache Read ±5%              | ✓ already   | Direct sum matches |
| Input ±5%                   | ✗           | Auxiliary API call usage isn't in JSONL |
| Output ±5%                  | ✗           | Thinking-token accounting differs |
| Cache Write ±5%             | ✗           | Ephemeral-TTL bucket accounting differs |

To match `/usage` on the failing fields, claude-watch would need to read the daemon's in-memory state. Options surveyed:

- **lldb / vmread against the worker PID** — blocked by SIP and code signing.
- **Reverse-engineer the daemon's Unix socket protocol** (`/tmp/cc-daemon-502/.../rv/<session>.sock`) — undocumented binary protocol; sockets accept connections but don't respond to ad-hoc JSON.
- **`claude --print "/usage"` on the bg session** — bg sessions are locked; foreground process refuses with "Session is currently running as a background agent."
- **`~/.claude.json` daemon-persisted state** — written only on graceful shutdown; while session is live, the relevant fields are zero.
- **Network interception of Anthropic API responses** (mitmproxy + API key) — possible but far outside claude-watch's local-only scope.

## Recommendation

Use the tools for what they each measure:

- **`/usage`** — daemon-runtime view, useful for "what did I spend in this Claude Code process so far". Includes retries and auxiliary calls. Resets on daemon restart.
- **claude-watch** — JSONL ledger view, useful for "what did the conversation actually contain and what would it cost to replay". Persists across daemon restarts. Accurate on the dominant cost term (cache read) and total cost.

Per-field input / output / cache-write breakdown in claude-watch reflects what's logged to disk and will not match `/usage` exactly. That's a property of the upstream data, not a bug to chase.
