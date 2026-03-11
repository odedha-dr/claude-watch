import { readFile } from 'fs/promises';
import { basename } from 'path';
import type {
  RawEntry, RawContent, SessionData, SessionDetail,
  Turn, TurnContent, ToolCallEntry, SubagentSpawn, SkillInvocation, ToolCombination,
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
  const fileContent = await readFile(filePath, 'utf-8');
  const lines = fileContent.trim().split('\n');

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

  // First pass: parse all entries and collect tool results keyed by tool_use_id
  interface ParsedEntry {
    raw: RawEntry;
    timestamp: string | null;
  }
  const parsed: ParsedEntry[] = [];
  const toolResults = new Map<string, { stdout?: string; stderr?: string; interrupted?: boolean; isImage?: boolean }>();

  for (const line of lines) {
    if (!line.trim()) continue;
    let raw: RawEntry;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    parsed.push({ raw, timestamp: raw.timestamp || null });

    // Collect tool results from user entries
    if (raw.type === 'user' && raw.toolUseResult) {
      // Find tool_use_id from message content
      const msg = raw.message;
      if (msg && Array.isArray(msg.content)) {
        for (const item of msg.content as RawContent[]) {
          if (item.type === 'tool_result' && item.tool_use_id) {
            toolResults.set(item.tool_use_id, {
              stdout: raw.toolUseResult.stdout as string | undefined,
              stderr: raw.toolUseResult.stderr as string | undefined,
              interrupted: raw.toolUseResult.interrupted as boolean | undefined,
              isImage: raw.toolUseResult.isImage as boolean | undefined,
            });
          }
        }
      }
    }
  }

  // Second pass: build turns with full content
  let turnNumber = 0;
  let lastRole: string | null = null;

  for (let i = 0; i < parsed.length; i++) {
    const { raw, timestamp } = parsed[i];

    if (raw.sessionId && sessionId === basename(filePath, '.jsonl')) {
      sessionId = raw.sessionId;
    }
    if (raw.cwd && !cwd) {
      cwd = raw.cwd;
    }

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

    // Token usage
    let turnTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, totalIn: 0 };
    if (msg.usage && role === 'assistant') {
      const u = msg.usage;
      const inp = u.input_tokens || 0;
      const out = u.output_tokens || 0;
      const cc = u.cache_creation_input_tokens || 0;
      const cr = u.cache_read_input_tokens || 0;
      tokens.input += inp;
      tokens.output += out;
      tokens.cacheCreation += cc;
      tokens.cacheRead += cr;
      turnTokens = { input: inp, output: out, cacheCreation: cc, cacheRead: cr, totalIn: inp + cc + cr };
    }

    // Build content blocks
    const turnContent: TurnContent[] = [];
    const turnToolNames: string[] = [];

    if (Array.isArray(msg.content)) {
      for (const item of msg.content as RawContent[]) {
        if (item.type === 'text' && item.text) {
          turnContent.push({ type: 'text', text: item.text });
        } else if (item.type === 'thinking' && item.thinking) {
          turnContent.push({ type: 'thinking', text: item.thinking });
        } else if (item.type === 'tool_use' && item.name) {
          const result = item.id ? toolResults.get(item.id) : undefined;
          turnContent.push({
            type: 'tool_use',
            toolName: item.name,
            toolInput: item.input,
            toolResult: result,
          });
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
        } else if (item.type === 'tool_result') {
          // tool_result in user messages — already captured via toolResults map
          const result = item.tool_use_id ? toolResults.get(item.tool_use_id) : undefined;
          turnContent.push({
            type: 'tool_result',
            toolResult: result,
          });
        } else {
          turnContent.push({ type: 'other', text: JSON.stringify(item).slice(0, 500) });
        }
      }
    } else if (typeof msg.content === 'string') {
      turnContent.push({ type: 'text', text: msg.content });
    }

    // Tool combinations
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

    // Compute latency: time between this entry and the next entry
    let durationMs: number | null = null;
    if (timestamp) {
      // Find next entry with a timestamp
      for (let j = i + 1; j < parsed.length; j++) {
        if (parsed[j].timestamp) {
          durationMs = new Date(parsed[j].timestamp!).getTime() - new Date(timestamp).getTime();
          break;
        }
      }
    }

    turns.push({
      number: turnNumber,
      role,
      timestamp,
      durationMs,
      toolCalls: turnToolNames,
      tokens: turnTokens,
      content: turnContent,
      stopReason: (msg as unknown as Record<string, unknown>).stop_reason as string | undefined,
    });
  }

  const toolAggregates = Object.entries(toolCountMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

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
