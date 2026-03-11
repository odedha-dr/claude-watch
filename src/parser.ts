import { readFile } from 'fs/promises';
import { basename } from 'path';
import type {
  RawEntry, RawContent, SessionData, SessionDetail,
  Turn, ToolCallEntry, SubagentSpawn, SkillInvocation, ToolCombination,
} from './types.js';
import { calculateCost } from './cost.js';

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

  // Token usage (only count from assistant messages)
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
    id: basename(filePath, '.jsonl'),
    filePath,
    project,
    model: '',
    cwd: '',
    startedAt: null,
    isActive: false,
    tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
    compactions: 0,
    toolCalls: {},
    agentSpawns: 0,
    skillInvocations: [],
    subagents: [],
    agentDescriptions: [],
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    let raw: RawEntry;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    // Use sessionId from first entry that has one
    if (raw.sessionId && session.id === basename(filePath, '.jsonl')) {
      session.id = raw.sessionId;
    }

    // Use cwd from first entry that has one
    if (raw.cwd && !session.cwd) {
      session.cwd = raw.cwd;
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

    // Extract agent descriptions
    if (Array.isArray(raw.message?.content)) {
      for (const item of raw.message!.content as RawContent[]) {
        if (item.type === 'tool_use' && item.name === 'Agent' && item.input?.description) {
          session.agentDescriptions.push(item.input.description as string);
        }
      }
    }
  }

  return session;
}

export async function parseSessionFileDetailed(filePath: string, project: string): Promise<SessionDetail> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  let sessionId = basename(filePath, '.jsonl');
  let model = '';
  let cwd = '';
  const tokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
  let compactions = 0;

  const turns: Turn[] = [];
  const toolCalls: ToolCallEntry[] = [];
  const subagentSpawns: SubagentSpawn[] = [];
  const skills: SkillInvocation[] = [];
  const toolCountMap: Record<string, number> = {};
  const comboCounts = new Map<string, { tools: string[]; count: number }>();

  let turnNumber = 0;
  let lastRole: string | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    let raw: RawEntry;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }

    if (raw.sessionId && sessionId === basename(filePath, '.jsonl')) {
      sessionId = raw.sessionId;
    }
    if (raw.cwd && !cwd) {
      cwd = raw.cwd;
    }

    // Compaction
    if (raw.type === 'system' && raw.subtype === 'compact_boundary') {
      compactions += 1;
      continue;
    }

    const msg = raw.message;
    if (!msg) continue;

    const role = msg.role as 'user' | 'assistant' | undefined;
    if (!role || (role !== 'user' && role !== 'assistant')) continue;

    // Track turn changes
    if (role !== lastRole) {
      turnNumber += 1;
      lastRole = role;
    }

    if (msg.model) model = msg.model;

    // Token usage from assistant messages
    let turnTokens = { input: 0, output: 0 };
    if (msg.usage && role === 'assistant') {
      const u = msg.usage;
      const inp = u.input_tokens || 0;
      const out = u.output_tokens || 0;
      tokens.input += inp;
      tokens.output += out;
      tokens.cacheCreation += u.cache_creation_input_tokens || 0;
      tokens.cacheRead += u.cache_read_input_tokens || 0;
      turnTokens = { input: inp, output: out };
    }

    // Tool calls from content
    const turnToolNames: string[] = [];
    if (Array.isArray(msg.content)) {
      for (const item of msg.content as RawContent[]) {
        if (item.type !== 'tool_use' || !item.name) continue;

        turnToolNames.push(item.name);
        toolCountMap[item.name] = (toolCountMap[item.name] || 0) + 1;

        toolCalls.push({
          name: item.name,
          turnNumber,
          input: item.input,
        });

        if (item.name === 'Agent') {
          subagentSpawns.push({
            id: item.id || '',
            description: (item.input?.description as string) || '',
            model: (item.input?.model as string) || undefined,
            turnNumber,
          });
        }

        if (item.name === 'Skill' && item.input?.skill) {
          skills.push({
            name: item.input.skill as string,
            turnNumber,
            args: (item.input.args as string) || undefined,
          });
        }
      }
    }

    // Tool combinations: unique tool names in this message
    if (turnToolNames.length > 1) {
      const uniqueTools = [...new Set(turnToolNames)].sort();
      const key = uniqueTools.join('+');
      const existing = comboCounts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        comboCounts.set(key, { tools: uniqueTools, count: 1 });
      }
    }

    turns.push({
      number: turnNumber,
      role,
      toolCalls: turnToolNames,
      tokens: turnTokens,
    });
  }

  // Build tool aggregates sorted by count desc
  const toolAggregates = Object.entries(toolCountMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Build tool combinations
  const toolCombinations: ToolCombination[] = [...comboCounts.values()]
    .sort((a, b) => b.count - a.count);

  const cost = calculateCost(model, tokens);

  return {
    id: sessionId,
    project,
    model,
    cwd,
    startedAt: null,
    isActive: false,
    tokens,
    cost,
    compactions,
    turns,
    toolCalls,
    toolAggregates,
    toolCombinations,
    subagentSpawns,
    skills,
    subagents: [],
  };
}
