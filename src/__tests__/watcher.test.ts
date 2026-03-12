import { describe, it, expect } from 'vitest';
import { SessionWatcher } from '../watcher.js';
import type { SessionData } from '../types.js';

function mockSession(overrides: Partial<SessionData> = {}): SessionData {
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

function createWatcherWithSessions(
  sessions: SessionData[]
): SessionWatcher {
  const watcher = new SessionWatcher(['/tmp'], false);
  const map = (watcher as any).sessions as Map<string, SessionData>;
  for (const s of sessions) {
    map.set(s.id, s);
  }
  return watcher;
}

describe('SessionWatcher.getProjects', () => {
  it('returns unique sorted project names from loaded sessions', () => {
    const watcher = createWatcherWithSessions([
      mockSession({ id: 's1', project: 'proj-b' }),
      mockSession({ id: 's2', project: 'proj-a' }),
      mockSession({ id: 's3', project: 'proj-b' }),
    ]);

    expect(watcher.getProjects()).toEqual(['proj-a', 'proj-b']);
  });

  it('returns empty array when no sessions loaded', () => {
    const watcher = new SessionWatcher(['/tmp'], false);
    expect(watcher.getProjects()).toEqual([]);
  });

  it('handles sessions with empty/undefined project', () => {
    const watcher = createWatcherWithSessions([
      mockSession({ id: 's1', project: '' }),
      mockSession({ id: 's2', project: 'proj-a' }),
    ]);

    // Empty string is falsy, so getProjects() skips it
    expect(watcher.getProjects()).toEqual(['proj-a']);
  });
});

describe('SessionWatcher.getSessions with projectFilter', () => {
  it('returns all sessions when no projectFilter is given (backward compat)', () => {
    const now = new Date();
    const watcher = createWatcherWithSessions([
      mockSession({ id: 's1', project: 'proj-a', startedAt: now }),
      mockSession({ id: 's2', project: 'proj-b', startedAt: now }),
    ]);

    expect(watcher.getSessions(false)).toHaveLength(2);
  });

  it('filters sessions by project name', () => {
    const now = new Date();
    const watcher = createWatcherWithSessions([
      mockSession({ id: 's1', project: 'proj-a', startedAt: now }),
      mockSession({ id: 's2', project: 'proj-b', startedAt: now }),
      mockSession({ id: 's3', project: 'proj-a', startedAt: now }),
    ]);

    const filtered = watcher.getSessions(false, 'proj-a');
    expect(filtered).toHaveLength(2);
    expect(filtered.every(s => s.project === 'proj-a')).toBe(true);
  });

  it('combines activeOnly and projectFilter', () => {
    const now = new Date();
    const watcher = createWatcherWithSessions([
      mockSession({ id: 's1', project: 'proj-a', isActive: true, startedAt: now }),
      mockSession({ id: 's2', project: 'proj-a', isActive: false, startedAt: now }),
      mockSession({ id: 's3', project: 'proj-b', isActive: true, startedAt: now }),
    ]);

    const filtered = watcher.getSessions(true, 'proj-a');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('s1');
  });

  it('returns empty when projectFilter matches no sessions', () => {
    const watcher = createWatcherWithSessions([
      mockSession({ id: 's1', project: 'proj-a', startedAt: new Date() }),
    ]);

    const filtered = watcher.getSessions(false, 'nonexistent');
    expect(filtered).toHaveLength(0);
  });

  it('sorts sessions by startedAt descending', () => {
    const t1 = new Date('2026-03-10T10:00:00Z');
    const t2 = new Date('2026-03-11T10:00:00Z');
    const t3 = new Date('2026-03-12T10:00:00Z');
    const watcher = createWatcherWithSessions([
      mockSession({ id: 's1', project: 'proj-a', startedAt: t1 }),
      mockSession({ id: 's2', project: 'proj-a', startedAt: t3 }),
      mockSession({ id: 's3', project: 'proj-a', startedAt: t2 }),
    ]);

    const result = watcher.getSessions(false, 'proj-a');
    expect(result.map(s => s.id)).toEqual(['s2', 's3', 's1']);
  });
});
