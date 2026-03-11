# claude-watch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI tool that monitors Claude Code sessions in real-time via TUI or web dashboard.

**Architecture:** JSONL parser extracts session metrics from `~/.claude/projects/` files. A watcher layer (chokidar + polling) detects changes and emits events. Two UI modes (blessed TUI and Express web with SSE) consume these events and render dashboards.

**Tech Stack:** TypeScript, Node.js, commander, blessed + blessed-contrib, express, chokidar, vitest

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`

**Step 1: Initialize project**

```bash
cd /Users/odedha/datarails/projects/personal/claude-watch
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install commander express chokidar blessed blessed-contrib
npm install -D typescript @types/node @types/blessed @types/express vitest tsx
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create minimal entry point**

Create `src/index.ts`:
```typescript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('claude-watch')
  .description('Live monitoring dashboard for Claude Code sessions')
  .version('0.1.0')
  .option('--web', 'Launch web dashboard instead of TUI')
  .option('--port <number>', 'Web server port', '3000')
  .option('--project <path>', 'Project directory to monitor')
  .option('--all', 'Monitor all projects')
  .action((options) => {
    console.log('claude-watch starting...', options);
  });

program.parse();
```

**Step 5: Update package.json with bin and scripts**

Add to `package.json`:
```json
{
  "bin": { "claude-watch": "dist/index.js" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "type": "module"
}
```

**Step 6: Verify scaffold works**

```bash
npx tsx src/index.ts --help
```
Expected: Shows help text with options.

**Step 7: Commit**

```bash
git init
echo "node_modules/\ndist/\n*.js.map" > .gitignore
git add -A
git commit -m "chore: scaffold claude-watch project"
```

---

### Task 2: Types

**Files:**
- Create: `src/types.ts`

**Step 1: Create types file**

Create `src/types.ts` with all shared interfaces:

```typescript
// Raw JSONL entry from Claude Code session logs
export interface RawEntry {
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId: string;
  version?: string;
  gitBranch?: string;
  type?: string;
  subtype?: string;
  message?: RawMessage;
  data?: Record<string, unknown>;
}

export interface RawMessage {
  role: string;
  model?: string;
  id?: string;
  type?: string;
  content?: RawContent[] | string;
  usage?: TokenUsage;
}

export interface RawContent {
  type: string;
  text?: string;
  name?: string;        // tool_use name
  id?: string;          // tool_use id
  input?: Record<string, unknown>;
  thinking?: string;
  tool_use_id?: string; // tool_result
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Processed session data
export interface SessionData {
  id: string;
  project: string;
  model: string;
  startedAt: Date | null;
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

export interface SubagentData {
  id: string;
  tokens: { input: number; output: number };
  toolCalls: Record<string, number>;
}

export interface ProjectInfo {
  name: string;
  path: string;
  sessionCount: number;
}

export interface WatcherEvent {
  type: 'session-updated' | 'session-added' | 'session-removed';
  sessionId: string;
  data: SessionData;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 3: JSONL Parser

**Files:**
- Create: `src/parser.ts`
- Create: `src/__tests__/parser.test.ts`
- Create: `src/__tests__/fixtures/sample-session.jsonl`

**Step 1: Create test fixture**

Create `src/__tests__/fixtures/sample-session.jsonl` with realistic JSONL entries modeled after the actual data found in `~/.claude/projects/`. Include:
- A progress entry (hook)
- A user message
- An assistant message with tool_use (Bash)
- An assistant message with tool_use (Agent)
- An assistant message with tool_use (Skill, input.skill = "brainstorming")
- An assistant message with usage data
- A system entry with subtype "compact_boundary"
- A second assistant message with usage data (to verify accumulation)

Each entry must have `sessionId: "test-session-1"`.

**Step 2: Write failing parser tests**

Create `src/__tests__/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseSessionFile, parseEntry } from '../parser.js';
import { join } from 'path';

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'sample-session.jsonl');

describe('parseEntry', () => {
  it('extracts token usage from assistant message', () => {
    const entry = {
      sessionId: 'test',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-6',
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 },
        content: []
      }
    };
    const result = parseEntry(entry);
    expect(result.tokens).toEqual({ input: 100, output: 50, cacheCreation: 200, cacheRead: 300 });
  });

  it('counts tool calls from assistant message', () => {
    const entry = {
      sessionId: 'test',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Bash' },
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Bash' },
        ]
      }
    };
    const result = parseEntry(entry);
    expect(result.toolCalls).toEqual({ Bash: 2, Read: 1 });
  });

  it('detects agent spawns', () => {
    const entry = {
      sessionId: 'test',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Agent' }]
      }
    };
    const result = parseEntry(entry);
    expect(result.agentSpawns).toBe(1);
  });

  it('extracts skill names', () => {
    const entry = {
      sessionId: 'test',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'brainstorming' } }]
      }
    };
    const result = parseEntry(entry);
    expect(result.skillInvocations).toEqual(['brainstorming']);
  });

  it('detects compaction', () => {
    const entry = { sessionId: 'test', type: 'system', subtype: 'compact_boundary' };
    const result = parseEntry(entry);
    expect(result.compactions).toBe(1);
  });
});

describe('parseSessionFile', () => {
  it('parses fixture file and aggregates data', async () => {
    const session = await parseSessionFile(FIXTURE_PATH, 'test-project');
    expect(session.id).toBe('test-session-1');
    expect(session.tokens.input).toBeGreaterThan(0);
    expect(session.tokens.output).toBeGreaterThan(0);
    expect(session.compactions).toBe(1);
    expect(session.toolCalls['Bash']).toBeGreaterThanOrEqual(1);
    expect(session.agentSpawns).toBeGreaterThanOrEqual(1);
    expect(session.skillInvocations).toContain('brainstorming');
  });
});
```

**Step 3: Run tests to verify they fail**

```bash
npx vitest run src/__tests__/parser.test.ts
```
Expected: FAIL - module `../parser.js` not found.

**Step 4: Implement parser**

Create `src/parser.ts`:

```typescript
import { readFile } from 'fs/promises';
import { basename } from 'path';
import type { RawEntry, RawContent, SessionData } from './types.js';

export interface EntryMetrics {
  model?: string;
  tokens: { input: number; output: number; cacheCreation: number; cacheRead: number };
  compactions: number;
  toolCalls: Record<string, number>;
  agentSpawns: number;
  skillInvocations: string[];
}

export function parseEntry(raw: RawEntry): EntryMetrics {
  const metrics: EntryMetrics = {
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    compactions: 0,
    toolCalls: {},
    agentSpawns: 0,
    skillInvocations: [],
  };

  // Compaction detection
  if (raw.type === 'system' && raw.subtype === 'compact_boundary') {
    metrics.compactions = 1;
    return metrics;
  }

  const msg = raw.message;
  if (!msg) return metrics;

  // Model
  if (msg.model) metrics.model = msg.model;

  // Token usage (only count from final/complete messages to avoid double-counting streaming)
  if (msg.usage && msg.role === 'assistant') {
    const u = msg.usage;
    metrics.tokens.input = u.input_tokens || 0;
    metrics.tokens.output = u.output_tokens || 0;
    metrics.tokens.cacheCreation = u.cache_creation_input_tokens || 0;
    metrics.tokens.cacheRead = u.cache_read_input_tokens || 0;
  }

  // Tool calls
  if (Array.isArray(msg.content)) {
    for (const item of msg.content as RawContent[]) {
      if (item.type === 'tool_use' && item.name) {
        metrics.toolCalls[item.name] = (metrics.toolCalls[item.name] || 0) + 1;

        if (item.name === 'Agent') {
          metrics.agentSpawns += 1;
        }

        if (item.name === 'Skill' && item.input?.skill) {
          metrics.skillInvocations.push(item.input.skill as string);
        }
      }
    }
  }

  return metrics;
}

export async function parseSessionFile(filePath: string, project: string): Promise<SessionData> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  const session: SessionData = {
    id: '',
    project,
    model: '',
    startedAt: null,
    isActive: false,
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    compactions: 0,
    toolCalls: {},
    agentSpawns: 0,
    skillInvocations: [],
    subagents: [],
  };

  // Extract session ID from filename
  const filename = basename(filePath, '.jsonl');
  session.id = filename;

  for (const line of lines) {
    if (!line.trim()) continue;
    let raw: RawEntry;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    // Use sessionId from first entry
    if (!session.id && raw.sessionId) {
      session.id = raw.sessionId;
    }

    const metrics = parseEntry(raw);

    // Model (take the latest)
    if (metrics.model) session.model = metrics.model;

    // Accumulate tokens
    session.tokens.input += metrics.tokens.input;
    session.tokens.output += metrics.tokens.output;
    session.tokens.cacheCreation += metrics.tokens.cacheCreation;
    session.tokens.cacheRead += metrics.tokens.cacheRead;

    // Compactions
    session.compactions += metrics.compactions;

    // Tool calls
    for (const [name, count] of Object.entries(metrics.toolCalls)) {
      session.toolCalls[name] = (session.toolCalls[name] || 0) + count;
    }

    // Agents & skills
    session.agentSpawns += metrics.agentSpawns;
    session.skillInvocations.push(...metrics.skillInvocations);
  }

  return session;
}
```

**Step 5: Run tests**

```bash
npx vitest run src/__tests__/parser.test.ts
```
Expected: All PASS.

**Step 6: Commit**

```bash
git add src/parser.ts src/__tests__/ src/types.ts
git commit -m "feat: JSONL parser with tests"
```

---

### Task 4: Project Discovery & Multi-Session Loading

**Files:**
- Create: `src/discovery.ts`
- Create: `src/__tests__/discovery.test.ts`

**Step 1: Write failing tests**

Create `src/__tests__/discovery.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getClaudeHome, discoverProjects, discoverSessions } from '../discovery.js';
import { join } from 'path';
import { homedir } from 'os';

describe('getClaudeHome', () => {
  it('returns ~/.claude path', () => {
    expect(getClaudeHome()).toBe(join(homedir(), '.claude'));
  });
});

describe('discoverProjects', () => {
  it('returns array of project info objects', async () => {
    const projects = await discoverProjects();
    expect(Array.isArray(projects)).toBe(true);
    // Should find at least one project on this machine
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0]).toHaveProperty('name');
    expect(projects[0]).toHaveProperty('path');
  });
});

describe('discoverSessions', () => {
  it('returns session data for a known project', async () => {
    const projects = await discoverProjects();
    if (projects.length === 0) return; // skip if no projects
    const sessions = await discoverSessions(projects[0].path);
    expect(Array.isArray(sessions)).toBe(true);
  });
});
```

**Step 2: Run tests to verify fail**

```bash
npx vitest run src/__tests__/discovery.test.ts
```

**Step 3: Implement discovery**

Create `src/discovery.ts`:

```typescript
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { ProjectInfo, SessionData, SubagentData } from './types.js';
import { parseSessionFile } from './parser.js';

export function getClaudeHome(): string {
  return join(homedir(), '.claude');
}

export async function discoverProjects(claudeHome?: string): Promise<ProjectInfo[]> {
  const home = claudeHome || getClaudeHome();
  const projectsDir = join(home, 'projects');
  const projects: ProjectInfo[] = [];

  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projPath = join(projectsDir, entry.name);
      const jsonlFiles = (await readdir(projPath)).filter(f => f.endsWith('.jsonl'));
      projects.push({
        name: entry.name.replace(/-/g, '/').replace(/^\//, ''),
        path: projPath,
        sessionCount: jsonlFiles.length,
      });
    }
  } catch {
    // No projects directory
  }

  return projects;
}

export async function discoverSessions(projectPath: string): Promise<SessionData[]> {
  const entries = await readdir(projectPath, { withFileTypes: true });
  const sessions: SessionData[] = [];
  const projectName = basename(projectPath);

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const filePath = join(projectPath, entry.name);
      try {
        const session = await parseSessionFile(filePath, projectName);
        // Check for subagents
        const sessionDir = join(projectPath, basename(entry.name, '.jsonl'));
        try {
          const subagentDir = join(sessionDir, 'subagents');
          const subFiles = await readdir(subagentDir);
          for (const sf of subFiles.filter(f => f.endsWith('.jsonl'))) {
            const subData = await parseSessionFile(join(subagentDir, sf), projectName);
            session.subagents.push({
              id: basename(sf, '.jsonl'),
              tokens: { input: subData.tokens.input, output: subData.tokens.output },
              toolCalls: subData.toolCalls,
            });
          }
        } catch {
          // No subagents directory
        }

        // Determine active status: file modified in last 2 minutes
        const fileStat = await stat(filePath);
        const twoMinAgo = Date.now() - 2 * 60 * 1000;
        session.isActive = fileStat.mtimeMs > twoMinAgo;
        session.startedAt = fileStat.birthtimeMs ? new Date(fileStat.birthtimeMs) : null;

        sessions.push(session);
      } catch {
        // Skip unparseable files
      }
    }
  }

  // Sort by startedAt descending (newest first)
  sessions.sort((a, b) => {
    if (!a.startedAt || !b.startedAt) return 0;
    return b.startedAt.getTime() - a.startedAt.getTime();
  });

  return sessions;
}
```

**Step 4: Run tests**

```bash
npx vitest run src/__tests__/discovery.test.ts
```
Expected: All PASS.

**Step 5: Commit**

```bash
git add src/discovery.ts src/__tests__/discovery.test.ts
git commit -m "feat: project discovery and multi-session loading"
```

---

### Task 5: File Watcher

**Files:**
- Create: `src/watcher.ts`

**Step 1: Implement watcher**

Create `src/watcher.ts`:

```typescript
import { watch } from 'chokidar';
import { EventEmitter } from 'events';
import { discoverSessions } from './discovery.js';
import type { SessionData, WatcherEvent } from './types.js';

export class SessionWatcher extends EventEmitter {
  private projectPath: string;
  private sessions: Map<string, SessionData> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(projectPath: string) {
    super();
    this.projectPath = projectPath;
  }

  async start(): Promise<void> {
    // Initial load
    await this.refresh();

    // File watching
    this.watcher = watch(this.projectPath, {
      ignoreInitial: true,
      depth: 2,
    });

    this.watcher.on('change', (path: string) => {
      if (path.endsWith('.jsonl')) {
        this.refresh();
      }
    });

    this.watcher.on('add', (path: string) => {
      if (path.endsWith('.jsonl')) {
        this.refresh();
      }
    });

    // Polling fallback every 5 seconds
    this.pollInterval = setInterval(() => this.refresh(), 5000);
  }

  async refresh(): Promise<void> {
    const sessions = await discoverSessions(this.projectPath);
    for (const session of sessions) {
      const existing = this.sessions.get(session.id);
      const isNew = !existing;
      this.sessions.set(session.id, session);

      const event: WatcherEvent = {
        type: isNew ? 'session-added' : 'session-updated',
        sessionId: session.id,
        data: session,
      };
      this.emit('change', event);
    }
  }

  getSessions(): SessionData[] {
    return Array.from(this.sessions.values()).sort((a, b) => {
      if (!a.startedAt || !b.startedAt) return 0;
      return b.startedAt.getTime() - a.startedAt.getTime();
    });
  }

  async stop(): Promise<void> {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.watcher) await this.watcher.close();
  }
}
```

**Step 2: Commit**

```bash
git add src/watcher.ts
git commit -m "feat: file watcher with chokidar + polling fallback"
```

---

### Task 6: Web Dashboard

**Files:**
- Create: `src/web/server.ts`
- Create: `src/web/public/index.html`

**Step 1: Create Express server with SSE**

Create `src/web/server.ts`:

```typescript
import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SessionWatcher } from '../watcher.js';
import type { SessionData } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createWebServer(watcher: SessionWatcher, port: number): void {
  const app = express();

  app.use(express.static(join(__dirname, 'public')));

  // SSE endpoint
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = () => {
      const sessions = watcher.getSessions();
      res.write(`data: ${JSON.stringify(sessions)}\n\n`);
    };

    // Send initial data
    send();

    // Send on changes
    watcher.on('change', send);

    req.on('close', () => {
      watcher.removeListener('change', send);
    });
  });

  // REST endpoint for initial load
  app.get('/api/sessions', (_req, res) => {
    res.json(watcher.getSessions());
  });

  app.listen(port, () => {
    console.log(`claude-watch web dashboard: http://localhost:${port}`);
  });
}
```

**Step 2: Create HTML dashboard**

Create `src/web/public/index.html` - a single-page dashboard with:
- Pico CSS from CDN for styling
- Session list table (ID, started, model, tokens in/out, compactions, status)
- Detail panel that shows on row click: token breakdown, tool call bars (inline SVG), agent spawns, skill list, subagent info
- EventSource connection to `/api/events` for live updates
- Auto-selects first session on load
- Formats numbers with commas, dates as relative time
- Active sessions get a green dot indicator

The HTML file should be self-contained (~300 lines): CSS variables for theming, a clean dark theme, responsive layout.

**Step 3: Verify manually**

```bash
npx tsx src/index.ts --web --port 3000
```
Open http://localhost:3000 - should see session data.

**Step 4: Commit**

```bash
git add src/web/
git commit -m "feat: web dashboard with SSE live updates"
```

---

### Task 7: TUI Dashboard

**Files:**
- Create: `src/tui/app.ts`
- Create: `src/tui/sessions.ts`
- Create: `src/tui/detail.ts`

**Step 1: Create session table widget**

Create `src/tui/sessions.ts` - a blessed-contrib table showing:
- Columns: #, Session ID (truncated), Started, Model, Tokens In, Tokens Out, Compacts, Status
- Active sessions marked with green bullet
- Selected row highlighted

**Step 2: Create detail panel widget**

Create `src/tui/detail.ts` - blessed box with:
- Left column: token breakdown (input, output, cache created, cache read, total)
- Right column: tool call bar chart (blessed-contrib bar)
- Bottom: agent spawns count, skill invocations list, subagent count

**Step 3: Create main TUI app**

Create `src/tui/app.ts`:
- Blessed screen setup with title "claude-watch"
- Top 40%: session table
- Bottom 60%: detail panel
- Key bindings: q=quit, up/down=navigate, enter=select, r=refresh
- Subscribes to watcher events and re-renders

**Step 4: Verify manually**

```bash
npx tsx src/index.ts
```
Expected: TUI renders with session data from current project.

**Step 5: Commit**

```bash
git add src/tui/
git commit -m "feat: TUI dashboard with blessed"
```

---

### Task 8: CLI Entry Point Wiring

**Files:**
- Modify: `src/index.ts`

**Step 1: Wire up CLI to watcher + UI modes**

Update `src/index.ts` to:
- Resolve project path: if `--project` use that, if `--all` use all projects, else auto-detect from cwd by matching against `~/.claude/projects/` directory names
- Create `SessionWatcher` for the resolved project
- If `--web`: call `createWebServer(watcher, port)`
- Else: call TUI `startApp(watcher)`
- Handle graceful shutdown (SIGINT → watcher.stop())

**Step 2: Verify both modes**

```bash
npx tsx src/index.ts --help
npx tsx src/index.ts --web --port 3001
npx tsx src/index.ts
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire CLI entry point to watcher and UI modes"
```

---

### Task 9: Build & Package

**Files:**
- Modify: `package.json`
- Create: `.npmignore`

**Step 1: Configure package.json for publishing**

Update `package.json`:
```json
{
  "name": "claude-watch",
  "version": "0.1.0",
  "description": "Live monitoring dashboard for Claude Code sessions",
  "bin": { "claude-watch": "dist/index.js" },
  "files": ["dist", "README.md"],
  "keywords": ["claude", "claude-code", "monitor", "dashboard", "tui"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/odedha/claude-watch"
  }
}
```

**Step 2: Build and test the binary**

```bash
npm run build
node dist/index.js --help
```

**Step 3: Handle static file copying**

The `public/` directory needs to be copied to `dist/web/public/` during build. Add a `postbuild` script:
```json
"postbuild": "cp -r src/web/public dist/web/public"
```

**Step 4: Test npx-style execution**

```bash
npm link
claude-watch --help
claude-watch --web --port 3001
```

**Step 5: Commit**

```bash
git add package.json .npmignore
git commit -m "chore: configure package for npm publishing"
```

---

### Task 10: README

**Files:**
- Create: `README.md`

**Step 1: Write README**

Include:
- Project name + one-liner description
- Screenshot/mockup of TUI and web modes
- Quick start: `npx claude-watch`
- All CLI options with examples
- What it monitors (tokens, compactions, tools, agents, skills)
- How it works (reads JSONL from ~/.claude/)
- License (MIT)

**Step 2: Final commit**

```bash
git add README.md
git commit -m "docs: add README"
```
