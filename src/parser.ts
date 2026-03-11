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
  }

  return session;
}
