import { describe, it, expect } from 'vitest';
import { parseSessionFile, parseEntry, parseSessionFileDetailed } from '../parser.js';
import { join } from 'path';

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'sample-session.jsonl');
const MULTI_TURN_FIXTURE = join(import.meta.dirname, 'fixtures', 'multi-turn-session.jsonl');

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
    expect(session.cwd).toBe('/Users/test/my-project');
  });
});

describe('parseSessionFileDetailed', () => {
  it('tracks turn numbering correctly', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    // 6 turns: user(1), assistant(2), user(3), assistant(4), user(5), assistant(6)
    expect(detail.turns).toHaveLength(6);
    expect(detail.turns[0].number).toBe(1);
    expect(detail.turns[0].role).toBe('user');
    expect(detail.turns[1].number).toBe(2);
    expect(detail.turns[1].role).toBe('assistant');
    expect(detail.turns[2].number).toBe(3);
    expect(detail.turns[3].number).toBe(4);
    expect(detail.turns[4].number).toBe(5);
    expect(detail.turns[5].number).toBe(6);
  });

  it('builds tool timeline in chronological order with turn numbers', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    expect(detail.toolCalls).toHaveLength(6);
    expect(detail.toolCalls[0]).toMatchObject({ name: 'Read', turnNumber: 2 });
    expect(detail.toolCalls[1]).toMatchObject({ name: 'Grep', turnNumber: 2 });
    expect(detail.toolCalls[2]).toMatchObject({ name: 'Agent', turnNumber: 4 });
    expect(detail.toolCalls[3]).toMatchObject({ name: 'Skill', turnNumber: 4 });
    expect(detail.toolCalls[4]).toMatchObject({ name: 'Read', turnNumber: 6 });
    expect(detail.toolCalls[5]).toMatchObject({ name: 'Grep', turnNumber: 6 });
  });

  it('extracts agent description and model into SubagentSpawn', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    expect(detail.subagentSpawns).toHaveLength(1);
    expect(detail.subagentSpawns[0].description).toBe('search codebase');
    expect(detail.subagentSpawns[0].model).toBe('sonnet');
    expect(detail.subagentSpawns[0].turnNumber).toBe(4);
  });

  it('extracts skill name and turn number into SkillInvocation', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    expect(detail.skills).toHaveLength(1);
    expect(detail.skills[0].name).toBe('brainstorming');
    expect(detail.skills[0].turnNumber).toBe(4);
    expect(detail.skills[0].args).toBe('--deep');
  });

  it('computes tool combinations with correct counts', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    // Read+Grep appears in turn 2 and turn 6
    const readGrep = detail.toolCombinations.find(
      c => c.tools.includes('Read') && c.tools.includes('Grep')
    );
    expect(readGrep).toBeDefined();
    expect(readGrep!.count).toBe(2);
  });

  it('produces tool aggregates sorted by count descending', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    expect(detail.toolAggregates.length).toBeGreaterThan(0);
    // Read: 2, Grep: 2, Agent: 1, Skill: 1
    expect(detail.toolAggregates[0].count).toBeGreaterThanOrEqual(detail.toolAggregates[1].count);
    const readAgg = detail.toolAggregates.find(a => a.name === 'Read');
    expect(readAgg!.count).toBe(2);
    const agentAgg = detail.toolAggregates.find(a => a.name === 'Agent');
    expect(agentAgg!.count).toBe(1);
  });

  it('calculates cost with correct structure and non-zero total', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    expect(detail.cost).toHaveProperty('input');
    expect(detail.cost).toHaveProperty('output');
    expect(detail.cost).toHaveProperty('cacheWrite');
    expect(detail.cost).toHaveProperty('cacheRead');
    expect(detail.cost).toHaveProperty('total');
    expect(detail.cost.total).toBeGreaterThan(0);
  });

  it('counts compactions correctly', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    expect(detail.compactions).toBe(1);
  });

  it('includes timestamps and computes latency (durationMs)', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    // Turn 1 (user) at 10:00:01, Turn 2 (assistant) at 10:00:04 → latency 3000ms
    expect(detail.turns[0].timestamp).toBe('2026-03-11T10:00:01.000Z');
    expect(detail.turns[0].durationMs).toBe(3000);
    // Turn 2 (assistant) at 10:00:04, next entry (user) at 10:00:10 → 6000ms
    expect(detail.turns[1].durationMs).toBe(6000);
  });

  it('includes per-turn cache token breakdown', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    const assistantTurn = detail.turns[1]; // turn 2 (assistant)
    expect(assistantTurn.tokens.cacheCreation).toBe(500);
    expect(assistantTurn.tokens.cacheRead).toBe(300);
    expect(assistantTurn.tokens.totalIn).toBe(1800); // 1000 + 500 + 300
  });

  it('includes content blocks with text and tool details', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    const turn2 = detail.turns[1]; // assistant turn with Read + Grep
    expect(turn2.content.length).toBeGreaterThanOrEqual(3); // text + 2 tool_use
    const textBlock = turn2.content.find(c => c.type === 'text');
    expect(textBlock?.text).toBe('Let me look at the code.');
    const toolBlock = turn2.content.find(c => c.type === 'tool_use' && c.toolName === 'Read');
    expect(toolBlock?.toolInput).toEqual({ file_path: '/src/index.ts' });
  });

  it('includes stopReason on assistant turns', async () => {
    const detail = await parseSessionFileDetailed(MULTI_TURN_FIXTURE, 'test-project');
    expect(detail.turns[1].stopReason).toBe('tool_use');
    expect(detail.turns[5].stopReason).toBe('end_turn');
  });
});
