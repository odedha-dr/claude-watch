import { describe, it, expect } from 'vitest';
import { getClaudeHome, discoverProjects, discoverSessions, discoverCustomSessions } from '../discovery.js';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

describe('getClaudeHome', () => {
  it('returns ~/.claude path', () => {
    expect(getClaudeHome()).toBe(join(homedir(), '.claude'));
  });
});

describe('discoverProjects', () => {
  it('returns array of project info objects', async () => {
    const projects = await discoverProjects();
    expect(Array.isArray(projects)).toBe(true);
    // On CI there may be no projects — only assert structure if found
    if (projects.length > 0) {
      expect(projects[0]).toHaveProperty('name');
      expect(projects[0]).toHaveProperty('path');
    }
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

describe('discoverCustomSessions', () => {
  it('discovers JSONL files in flat directories', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-test-'));
    // Write a minimal valid JSONL file
    const entry = JSON.stringify({
      sessionId: 'test-session-1',
      cwd: '/tmp/test',
      timestamp: new Date().toISOString(),
      type: 'assistant',
      message: { role: 'assistant', model: 'test-model', content: 'hello' },
    });
    writeFileSync(join(dir, 'session1.jsonl'), entry + '\n');

    const sessions = await discoverCustomSessions([dir]);
    expect(sessions.length).toBe(1);
    expect(sessions[0].source).toBe('custom');
    expect(sessions[0].model).toBe('test-model');
  });

  it('returns empty array for non-existent directories', async () => {
    const sessions = await discoverCustomSessions(['/tmp/does-not-exist-xyz']);
    expect(sessions).toEqual([]);
  });

  it('handles multiple directories', async () => {
    const dir1 = mkdtempSync(join(tmpdir(), 'cw-test-'));
    const dir2 = mkdtempSync(join(tmpdir(), 'cw-test-'));
    const entry1 = JSON.stringify({
      sessionId: 's1', cwd: '/tmp', timestamp: new Date().toISOString(),
      type: 'assistant', message: { role: 'assistant', model: 'm1', content: 'a' },
    });
    const entry2 = JSON.stringify({
      sessionId: 's2', cwd: '/tmp', timestamp: new Date().toISOString(),
      type: 'assistant', message: { role: 'assistant', model: 'm2', content: 'b' },
    });
    writeFileSync(join(dir1, 's1.jsonl'), entry1 + '\n');
    writeFileSync(join(dir2, 's2.jsonl'), entry2 + '\n');

    const sessions = await discoverCustomSessions([dir1, dir2]);
    expect(sessions.length).toBe(2);
  });
});
