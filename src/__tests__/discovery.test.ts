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
