import { watch } from 'chokidar';
import { EventEmitter } from 'events';
import { discoverSessions } from './discovery.js';
import type { SessionData, WatcherEvent } from './types.js';

export class SessionWatcher extends EventEmitter {
  private projectPaths: string[];
  private sessions: Map<string, SessionData> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private watchers: ReturnType<typeof watch>[] = [];

  constructor(projectPaths: string | string[]) {
    super();
    this.projectPaths = Array.isArray(projectPaths) ? projectPaths : [projectPaths];
  }

  async start(): Promise<void> {
    // Initial load
    await this.refresh();

    // File watching for each project path
    for (const projectPath of this.projectPaths) {
      const w = watch(projectPath, {
        ignoreInitial: true,
        depth: 2,
      });

      w.on('change', (path: string) => {
        if (path.endsWith('.jsonl')) {
          this.refresh();
        }
      });

      w.on('add', (path: string) => {
        if (path.endsWith('.jsonl')) {
          this.refresh();
        }
      });

      this.watchers.push(w);
    }

    // Polling fallback every 5 seconds
    this.pollInterval = setInterval(() => this.refresh(), 5000);
  }

  async refresh(): Promise<void> {
    for (const projectPath of this.projectPaths) {
      try {
        const sessions = await discoverSessions(projectPath);
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
      } catch {
        // Skip projects that fail to read
      }
    }
  }

  getSessions(activeOnly: boolean = false): SessionData[] {
    let sessions = Array.from(this.sessions.values());
    if (activeOnly) {
      sessions = sessions.filter(s => s.isActive);
    }
    return sessions.sort((a, b) => {
      if (!a.startedAt || !b.startedAt) return 0;
      return b.startedAt.getTime() - a.startedAt.getTime();
    });
  }

  getSessionById(id: string): SessionData | undefined {
    return this.sessions.get(id);
  }

  async stop(): Promise<void> {
    if (this.pollInterval) clearInterval(this.pollInterval);
    for (const w of this.watchers) {
      await w.close();
    }
  }
}
