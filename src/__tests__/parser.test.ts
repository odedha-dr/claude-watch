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
