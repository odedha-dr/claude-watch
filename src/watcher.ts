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

  async stop(): Promise<void> {
    if (this.pollInterval) clearInterval(this.pollInterval);
    if (this.watcher) await this.watcher.close();
  }
}
