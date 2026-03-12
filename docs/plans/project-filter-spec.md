# Project Filter - Implementation Spec

**Feature:** Filter sessions by project directory in TUI and Web UI
**Branch:** `feature/project-filter`
**Date:** 2026-03-12

---

## Overview

Currently claude-watch monitors all discovered projects and shows all sessions in a flat list. This feature adds a project filter so users can narrow the session list to a specific project directory. The filter applies to both TUI and Web UI, with an optional CLI flag.

## Architecture Summary

```
Data flow: discovery.ts -> watcher.ts -> (tui/app.ts | web/server.ts)
```

- `SessionData.project` holds the project directory basename (e.g. `-Users-omrybass-work-ai-claude-watch`)
- `SessionWatcher` stores all sessions in a `Map<string, SessionData>` and exposes `getSessions(activeOnly)`
- TUI subscribes to watcher `change` events and calls `getSessions()`
- Web server exposes `/api/sessions` and `/api/events` (SSE), both call `getSessions()`
- `SessionSummary` (web API shape) currently lacks a `project` field

## Tasks

### Task 1: Add `project` field to `SessionSummary` (types.ts)

**File:** `src/types.ts`

**Change:** Add `project: string` to the `SessionSummary` interface.

```typescript
// In SessionSummary, add after `filePath`:
project: string;
```

**Rationale:** The web UI needs the project name on each session to build the project dropdown and to filter client-side.

---

### Task 2: Add `getProjects()` method to `SessionWatcher` (watcher.ts)

**File:** `src/watcher.ts`

**Change:** Add a method that derives unique project names from loaded sessions.

```typescript
/** Returns unique project names from all loaded sessions, sorted alphabetically. */
getProjects(): string[] {
  const projects = new Set<string>();
  for (const session of this.sessions.values()) {
    if (session.project) {
      projects.add(session.project);
    }
  }
  return [...projects].sort();
}
```

**Rationale:** Both TUI and Web UI need the list of available projects to populate filter controls. Deriving from loaded sessions (rather than re-scanning disk) is consistent and fast.

---

### Task 3: Add `getSessions` project filter parameter (watcher.ts)

**File:** `src/watcher.ts`

**Change:** Extend `getSessions` to accept an optional `projectFilter` parameter.

Current signature:
```typescript
getSessions(activeOnly: boolean = false): SessionData[]
```

New signature:
```typescript
getSessions(activeOnly: boolean = false, projectFilter?: string): SessionData[]
```

Implementation: After the `activeOnly` filter, add:
```typescript
if (projectFilter) {
  sessions = sessions.filter(s => s.project === projectFilter);
}
```

This goes between the `activeOnly` filter and the sort.

---

### Task 4: Include `project` in `toSummary` (web/server.ts)

**File:** `src/web/server.ts`

**Change:** Add `project: s.project` to the `toSummary` function's return object.

```typescript
// In toSummary(), add after filePath:
project: s.project,
```

---

### Task 5: Add `/api/projects` endpoint (web/server.ts)

**File:** `src/web/server.ts`

**Change:** Add a REST endpoint that returns the list of discovered project names.

```typescript
app.get('/api/projects', (_req, res) => {
  res.json(watcher.getProjects());
});
```

Place this after the existing `/api/sessions` route.

---

### Task 6: Add `--filter-project` CLI flag (index.ts)

**File:** `src/index.ts`

**Change:** Add a new commander option and pass it through to TUI/Web.

1. Add option to program:
```typescript
.option('--filter-project <name>', 'Filter sessions to a specific project name')
```

2. Pass the filter to `startApp` and `createWebServer`:
```typescript
if (options.tui) {
  startApp(watcher, { initialProjectFilter: options.filterProject });
} else {
  const port = parseInt(options.port, 10);
  createWebServer(watcher, port, { initialProjectFilter: options.filterProject });
}
```

Note: `options.filterProject` is auto-camelCased by commander from `--filter-project`.

---

### Task 7: TUI project filter (tui/app.ts)

**File:** `src/tui/app.ts`

**Changes:**

1. Update function signature to accept options:
```typescript
export function startApp(
  watcher: SessionWatcher,
  options?: { initialProjectFilter?: string }
): void {
```

2. Add project filter state:
```typescript
let projectFilter: string | undefined = options?.initialProjectFilter;
```

3. Update `refresh()` to use the filter:
```typescript
function refresh() {
  sessions = watcher.getSessions(activeOnly, projectFilter);
  // ... rest unchanged
}
```

4. Update `updateStatus()` to show active project filter:
```typescript
function updateStatus() {
  const filterLabel = activeOnly ? 'active' : 'all';
  const projectLabel = projectFilter || 'all projects';
  const count = sessions.length;
  const activeCount = sessions.filter(s => s.isActive).length;
  statusBar.setContent(
    ` ${count} sessions (${activeCount} active) [${filterLabel}] [${projectLabel}]` +
    `  |  j/k:navigate  a:toggle filter  p:project  r:refresh  q:quit`
  );
}
```

5. Add `p` keybinding to cycle through projects:
```typescript
screen.key(['p'], () => {
  const projects = watcher.getProjects();
  if (projects.length === 0) return;

  if (!projectFilter) {
    // Currently showing all -> go to first project
    projectFilter = projects[0];
  } else {
    const idx = projects.indexOf(projectFilter);
    if (idx === -1 || idx === projects.length - 1) {
      // Last project or not found -> back to all
      projectFilter = undefined;
    } else {
      projectFilter = projects[idx + 1];
    }
  }
  selectedIndex = 0;
  refresh();
});
```

The cycle order is: all -> project1 -> project2 -> ... -> projectN -> all.

---

### Task 8: Web UI project filter (web/public/index.html)

**File:** `src/web/public/index.html`

**Changes:**

1. **Add state variable** (in the `// ---- State ----` section):
```javascript
let projectFilter = '';  // empty string = all projects
```

2. **Add CSS for project filter dropdown** (after `.time-filter button.active` styles):
```css
.project-filter {
  margin-top: 8px;
}
.project-filter select {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-family: inherit;
  font-size: 11px;
  border-radius: 4px;
  cursor: pointer;
}
.project-filter select:focus {
  outline: none;
  border-color: var(--accent);
}
```

3. **Add HTML dropdown** (after the `.time-filter` div, still inside `.sidebar-header`):
```html
<div class="project-filter">
  <select id="project-select">
    <option value="">All Projects</option>
  </select>
</div>
```

4. **Populate dropdown on data update.** Add a function `updateProjectDropdown()` that:
   - Extracts unique project names from `allSessions` via `new Set(allSessions.map(s => s.project).filter(Boolean))`
   - Sorts them alphabetically
   - Rebuilds the `<select>` options, keeping current selection if still valid
   - Converts project directory names to readable paths: `p.replace(/-/g, '/').replace(/^\//, '')`
   - Call this inside the SSE `onmessage` handler after setting `allSessions`

5. **Wire up the dropdown event listener** (after the time filter event listener):
```javascript
document.getElementById('project-select').addEventListener('change', (e) => {
  projectFilter = e.target.value;
  renderSidebar();
});
```

6. **Update `getVisibleSessions()`** to apply project filter:
```javascript
function getVisibleSessions() {
  return allSessions.filter(s => {
    if (projectFilter && s.project !== projectFilter) return false;
    return s.isActive || isInRange(s.startedAt);
  });
}
```

---

### Task 9: Pass initial project filter to web server (web/server.ts)

**File:** `src/web/server.ts`

**Change:** Update `createWebServer` signature to accept options, and expose the initial filter via an API endpoint.

```typescript
export function createWebServer(
  watcher: SessionWatcher,
  port: number,
  options?: { initialProjectFilter?: string }
): void {
```

Add an endpoint:
```typescript
app.get('/api/config', (_req, res) => {
  res.json({
    initialProjectFilter: options?.initialProjectFilter || '',
  });
});
```

In the web UI JavaScript, fetch this on load:
```javascript
fetch('/api/config').then(r => r.json()).then(cfg => {
  if (cfg.initialProjectFilter) {
    projectFilter = cfg.initialProjectFilter;
    document.getElementById('project-select').value = projectFilter;
  }
});
```

---

### Task 10: Tests (src/__tests__/watcher.test.ts)

**File:** `src/__tests__/watcher.test.ts` (new file)

**Tests to add:**

```typescript
import { describe, it, expect } from 'vitest';
import { SessionWatcher } from '../watcher.js';
import type { SessionData } from '../types.js';

function mockSession(overrides: Partial<SessionData>): SessionData {
  return {
    id: 'test-id',
    filePath: '/tmp/test.jsonl',
    project: 'default-project',
    source: 'claude-code',
    model: 'claude-sonnet-4-20250514',
    cwd: '/tmp',
    startedAt: new Date(),
    isActive: false,
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    compactions: 0,
    toolCalls: {},
    agentSpawns: 0,
    skillInvocations: [],
    subagents: [],
    agentDescriptions: [],
    ...overrides,
  };
}

describe('SessionWatcher.getProjects', () => {
  it('returns unique sorted project names from loaded sessions', () => {
    const watcher = new SessionWatcher(['/tmp']);
    // Access private sessions map for testing
    const sessions = (watcher as any).sessions as Map<string, SessionData>;
    sessions.set('s1', mockSession({ id: 's1', project: 'proj-b' }));
    sessions.set('s2', mockSession({ id: 's2', project: 'proj-a' }));
    sessions.set('s3', mockSession({ id: 's3', project: 'proj-b' }));

    expect(watcher.getProjects()).toEqual(['proj-a', 'proj-b']);
  });

  it('returns empty array when no sessions loaded', () => {
    const watcher = new SessionWatcher(['/tmp']);
    expect(watcher.getProjects()).toEqual([]);
  });
});

describe('SessionWatcher.getSessions with projectFilter', () => {
  it('returns all sessions when no projectFilter is given', () => {
    const watcher = new SessionWatcher(['/tmp']);
    const sessions = (watcher as any).sessions as Map<string, SessionData>;
    sessions.set('s1', mockSession({ id: 's1', project: 'proj-a', startedAt: new Date() }));
    sessions.set('s2', mockSession({ id: 's2', project: 'proj-b', startedAt: new Date() }));

    expect(watcher.getSessions(false).length).toBe(2);
  });

  it('filters sessions by project name', () => {
    const watcher = new SessionWatcher(['/tmp']);
    const sessions = (watcher as any).sessions as Map<string, SessionData>;
    sessions.set('s1', mockSession({ id: 's1', project: 'proj-a', startedAt: new Date() }));
    sessions.set('s2', mockSession({ id: 's2', project: 'proj-b', startedAt: new Date() }));

    const filtered = watcher.getSessions(false, 'proj-a');
    expect(filtered.length).toBe(1);
    expect(filtered[0].project).toBe('proj-a');
  });

  it('combines activeOnly and projectFilter', () => {
    const watcher = new SessionWatcher(['/tmp']);
    const sessions = (watcher as any).sessions as Map<string, SessionData>;
    sessions.set('s1', mockSession({ id: 's1', project: 'proj-a', isActive: true, startedAt: new Date() }));
    sessions.set('s2', mockSession({ id: 's2', project: 'proj-a', isActive: false, startedAt: new Date() }));
    sessions.set('s3', mockSession({ id: 's3', project: 'proj-b', isActive: true, startedAt: new Date() }));

    const filtered = watcher.getSessions(true, 'proj-a');
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('s1');
  });
});
```

---

## File Change Summary

| File | Action | Summary |
|------|--------|---------|
| `src/types.ts` | Modify | Add `project: string` to `SessionSummary` |
| `src/watcher.ts` | Modify | Add `getProjects()` method; extend `getSessions()` with `projectFilter` param |
| `src/web/server.ts` | Modify | Add `project` to `toSummary()`; add `/api/projects` and `/api/config` endpoints; update `createWebServer` signature |
| `src/index.ts` | Modify | Add `--filter-project` CLI option; pass to `startApp`/`createWebServer` |
| `src/tui/app.ts` | Modify | Add project filter state, `p` keybinding, status bar display; update `startApp` signature |
| `src/web/public/index.html` | Modify | Add project dropdown HTML/CSS/JS, `projectFilter` state, update `getVisibleSessions()` |
| `src/__tests__/watcher.test.ts` | Create | Tests for `getProjects()` and `getSessions()` with `projectFilter` |

## Acceptance Criteria

### AC-1: Project dropdown populates dynamically
- **Given** sessions exist from 3 different projects
- **When** the web UI loads
- **Then** the project dropdown shows "All Projects" plus the 3 project names sorted alphabetically

### AC-2: Web UI filters by project
- **Given** sessions from projects A and B are loaded, and user selects project A in the dropdown
- **When** the sidebar re-renders
- **Then** only sessions from project A are shown, and summary widgets reflect only project A totals

### AC-3: Web UI "All Projects" shows everything
- **Given** a project filter is active
- **When** user selects "All Projects" in the dropdown
- **Then** all sessions matching the time range are shown again

### AC-4: TUI cycles through projects with `p` key
- **Given** sessions from projects A, B, and C are loaded and no project filter is active
- **When** user presses `p` repeatedly
- **Then** the filter cycles: A -> B -> C -> all -> A -> ...

### AC-5: TUI status bar shows project filter
- **Given** the TUI is running with project filter set to project A
- **When** the status bar renders
- **Then** it displays the project name (e.g. `[project-a]`) instead of `[all projects]`

### AC-6: CLI --filter-project flag works
- **Given** user runs `claude-watch --tui --filter-project my-project`
- **When** the TUI starts
- **Then** sessions are initially filtered to `my-project` and the status bar shows the project name

### AC-7: Project filter combines with active-only filter
- **Given** TUI has `activeOnly=true` and `projectFilter='project-a'`
- **When** `getSessions(true, 'project-a')` is called
- **Then** only active sessions from project-a are returned

### AC-8: SessionSummary includes project field
- **Given** a session with `project: 'my-project'`
- **When** the web API returns session summaries via `/api/sessions` or SSE
- **Then** each summary object contains a `project` field

### AC-9: /api/projects endpoint returns project list
- **Given** the watcher has loaded sessions from 3 projects
- **When** GET `/api/projects` is called
- **Then** it returns a JSON array of 3 sorted project name strings

### AC-10: Web project dropdown persists across SSE updates
- **Given** user has selected project B in the dropdown
- **When** new SSE data arrives with sessions from projects A, B, and C
- **Then** the dropdown value remains "project B" and the filter stays applied

## Implementation Order

1. `src/types.ts` - Add `project` to `SessionSummary` (no dependencies)
2. `src/watcher.ts` - Add `getProjects()` and extend `getSessions()` (depends on types)
3. `src/web/server.ts` - Add `project` to `toSummary`, add endpoints, update signature (depends on watcher)
4. `src/index.ts` - Add CLI flag, pass options through (depends on server + tui signatures)
5. `src/tui/app.ts` - Add project filter UI (depends on watcher)
6. `src/web/public/index.html` - Add project filter dropdown (depends on server API)
7. `src/__tests__/watcher.test.ts` - Tests (depends on watcher changes)

## Edge Cases

- **No sessions loaded yet:** Project dropdown shows only "All Projects". `p` in TUI is a no-op.
- **Single project:** Dropdown has 2 options (All + the one project). `p` toggles between them.
- **CoWork sessions:** CoWork sessions have `project: 'cowork'`. They appear as a filterable project.
- **CLI filter with invalid project name:** Sessions list will be empty. No crash.
- **SSE update removes last session of filtered project:** Dropdown resets to "All Projects" since the project no longer exists in the data.
