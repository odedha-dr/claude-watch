import { readFile } from 'fs/promises';
import { basename } from 'path';
import type {
  RawEntry, RawContent, SessionData, SessionDetail, SessionSource, FlowNode,
  Turn, TurnStep, TurnContent, ToolCallEntry, SubagentSpawn, SkillInvocation, ToolCombination,
} from './types.js';

/** Normalize CoWork field names to match Claude Code conventions */
function normalizeEntry(raw: RawEntry): void {
  // CoWork uses session_id instead of sessionId
  if (!raw.sessionId && raw.session_id) {
    raw.sessionId = raw.session_id;
  }
  // CoWork uses _audit_timestamp instead of timestamp
  if (!raw.timestamp && raw._audit_timestamp) {
    raw.timestamp = raw._audit_timestamp;
  }
}
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

export async function parseSessionFile(filePath: string, project: string, source: SessionSource = 'claude-code'): Promise<SessionData> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.trim().split('\n');

  const session: SessionData = {
    id: basename(filePath, '.jsonl'),
    filePath,
    project,
    source,
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

    normalizeEntry(raw);

    // Use sessionId from first entry that has one
    if (raw.sessionId && session.id === basename(filePath, '.jsonl')) {
      session.id = raw.sessionId;
    }

    // Use cwd from first entry that has one
    if (raw.cwd && !session.cwd) {
      session.cwd = raw.cwd;
    }

    // Use timestamp from first entry that has one
    if (raw.timestamp && !session.startedAt) {
      session.startedAt = new Date(raw.timestamp);
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
  const toolResults = new Map<string, { stdout?: string; stderr?: string; content?: string; isError?: boolean; interrupted?: boolean; isImage?: boolean }>();
  // Map tool_use_id → agentId from queue-operation entries
  const toolUseToAgent = new Map<string, string>();

  for (const line of lines) {
    if (!line.trim()) continue;
    let raw: RawEntry;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    normalizeEntry(raw);
    parsed.push({ raw, timestamp: raw.timestamp || null });

    // Collect tool results from user entries
    if (raw.type === 'user') {
      const msg = raw.message;
      if (msg && Array.isArray(msg.content)) {
        for (const item of msg.content as RawContent[]) {
          if (item.type === 'tool_result' && item.tool_use_id) {
            const tur = raw.toolUseResult;
            toolResults.set(item.tool_use_id, {
              // Bash-style stdout/stderr
              stdout: tur?.stdout as string | undefined,
              stderr: tur?.stderr as string | undefined,
              // Generic content from message.content tool_result (works for all tools)
              content: typeof item.content === 'string' ? item.content : undefined,
              isError: item.is_error || false,
              interrupted: tur?.interrupted as boolean | undefined,
              isImage: tur?.isImage as boolean | undefined,
            });
          }
        }
      }
    }

    // Collect agent ID mappings from queue-operation entries
    if (raw.type === 'queue-operation' && raw.content) {
      const taskIdMatch = raw.content.match(/<task-id>(.*?)<\/task-id>/);
      const toolUseIdMatch = raw.content.match(/<tool-use-id>(.*?)<\/tool-use-id>/);
      if (taskIdMatch && toolUseIdMatch) {
        toolUseToAgent.set(toolUseIdMatch[1], taskIdMatch[1]);
      }
    }
  }

  // Second pass: build steps, then group into logical turns
  // A "user turn" = actual user message(s)
  // An "assistant turn" = all assistant + tool-result entries until the next user message
  const allSteps: TurnStep[] = [];
  const stepCounts: { toolCalls: number; spawns: number; skills: number }[] = [];

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

    const rawRole = msg.role as 'user' | 'assistant' | undefined;
    if (!rawRole || (rawRole !== 'user' && rawRole !== 'assistant')) continue;

    // Detect if this user message is actually a tool result
    const isToolResult = rawRole === 'user' && !!raw.toolUseResult;
    const stepRole: 'user' | 'assistant' | 'tool-result' = isToolResult ? 'tool-result' : rawRole;

    if (msg.model) model = msg.model;

    // Token usage
    let stepTokens = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, totalIn: 0 };
    if (msg.usage && stepRole === 'assistant') {
      const u = msg.usage;
      const inp = u.input_tokens || 0;
      const out = u.output_tokens || 0;
      const cc = u.cache_creation_input_tokens || 0;
      const cr = u.cache_read_input_tokens || 0;
      tokens.input += inp;
      tokens.output += out;
      tokens.cacheCreation += cc;
      tokens.cacheRead += cr;
      stepTokens = { input: inp, output: out, cacheCreation: cc, cacheRead: cr, totalIn: inp + cc + cr };
    }

    // Build content blocks
    const stepContent: TurnContent[] = [];
    const stepToolNames: string[] = [];
    let stepToolCallCount = 0;
    let stepSpawnCount = 0;
    let stepSkillCount = 0;

    if (Array.isArray(msg.content)) {
      for (const item of msg.content as RawContent[]) {
        if (item.type === 'text' && item.text) {
          stepContent.push({ type: 'text', text: item.text });
        } else if (item.type === 'thinking' && item.thinking) {
          stepContent.push({ type: 'thinking', text: item.thinking });
        } else if (item.type === 'tool_use' && item.name) {
          const result = item.id ? toolResults.get(item.id) : undefined;
          stepContent.push({
            type: 'tool_use',
            toolName: item.name,
            toolInput: item.input,
            toolResult: result,
          });
          stepToolNames.push(item.name);
          toolCountMap[item.name] = (toolCountMap[item.name] || 0) + 1;

          // turnNumber will be set after grouping; use 0 as placeholder
          toolCalls.push({
            name: item.name,
            turnNumber: 0,
            input: item.input,
          });
          stepToolCallCount++;

          if (item.name === 'Agent') {
            const toolUseId = item.id || '';
            subagentSpawns.push({
              id: toolUseId,
              agentId: toolUseToAgent.get(toolUseId),
              description: (item.input?.description as string) || '',
              model: (item.input?.model as string) || undefined,
              turnNumber: 0,
              timestamp: timestamp || undefined,
            });
            stepSpawnCount++;
          }
          if (item.name === 'Skill' && item.input?.skill) {
            skills.push({
              name: item.input.skill as string,
              turnNumber: 0,
              args: (item.input.args as string) || undefined,
            });
            stepSkillCount++;
          }
        } else if (item.type === 'tool_result') {
          const result = item.tool_use_id ? toolResults.get(item.tool_use_id) : undefined;
          stepContent.push({
            type: 'tool_result',
            toolResult: result,
          });
        } else {
          stepContent.push({ type: 'other', text: JSON.stringify(item).slice(0, 500) });
        }
      }
    } else if (typeof msg.content === 'string') {
      stepContent.push({ type: 'text', text: msg.content });
    }

    // Tool combinations (per step)
    if (stepToolNames.length > 1) {
      const uniqueTools = [...new Set(stepToolNames)].sort();
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
      for (let j = i + 1; j < parsed.length; j++) {
        if (parsed[j].timestamp) {
          durationMs = new Date(parsed[j].timestamp!).getTime() - new Date(timestamp).getTime();
          break;
        }
      }
    }

    allSteps.push({
      role: stepRole,
      timestamp,
      durationMs,
      toolCalls: stepToolNames,
      tokens: stepTokens,
      content: stepContent,
      stopReason: (msg as unknown as Record<string, unknown>).stop_reason as string | undefined,
    });
    stepCounts.push({ toolCalls: stepToolCallCount, spawns: stepSpawnCount, skills: stepSkillCount });
  }

  // Group steps into logical turns:
  // - A new "user" step starts a new user turn
  // - A new "assistant" step after a user turn (or at start) starts a new assistant turn
  // - "tool-result" and subsequent "assistant" steps belong to the current assistant turn
  let turnNumber = 0;
  let currentTurn: Turn | null = null;
  let toolCallIdx = 0;
  let spawnIdx = 0;
  let skillIdx = 0;

  for (let si = 0; si < allSteps.length; si++) {
    const step = allSteps[si];
    const counts = stepCounts[si];
    const logicalRole: 'user' | 'assistant' = step.role === 'tool-result' ? 'assistant' : step.role;

    // Start a new turn when the logical role changes
    if (!currentTurn || logicalRole !== currentTurn.role) {
      if (currentTurn) turns.push(currentTurn);
      turnNumber += 1;
      currentTurn = {
        number: turnNumber,
        role: logicalRole,
        timestamp: step.timestamp,
        durationMs: null,
        toolCalls: [],
        tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, totalIn: 0 },
        steps: [],
        content: [],
        stopReason: undefined,
      };
    }

    // Add step to current turn
    currentTurn.steps.push(step);
    currentTurn.content.push(...step.content);
    currentTurn.toolCalls.push(...step.toolCalls);
    currentTurn.tokens.input += step.tokens.input;
    currentTurn.tokens.output += step.tokens.output;
    currentTurn.tokens.cacheCreation += step.tokens.cacheCreation;
    currentTurn.tokens.cacheRead += step.tokens.cacheRead;
    currentTurn.tokens.totalIn += step.tokens.totalIn;
    if (step.stopReason) currentTurn.stopReason = step.stopReason;

    // Fix up turn numbers for this step's toolCalls, subagentSpawns, skills
    for (let k = 0; k < counts.toolCalls; k++) {
      toolCalls[toolCallIdx + k].turnNumber = turnNumber;
    }
    toolCallIdx += counts.toolCalls;
    for (let k = 0; k < counts.spawns; k++) {
      subagentSpawns[spawnIdx + k].turnNumber = turnNumber;
    }
    spawnIdx += counts.spawns;
    for (let k = 0; k < counts.skills; k++) {
      skills[skillIdx + k].turnNumber = turnNumber;
    }
    skillIdx += counts.skills;
  }
  if (currentTurn) turns.push(currentTurn);

  // Compute total duration per turn: first step timestamp to last step's end
  for (const turn of turns) {
    const firstTs = turn.steps[0]?.timestamp;
    const lastStep = turn.steps[turn.steps.length - 1];
    if (firstTs && lastStep?.timestamp && lastStep.durationMs != null) {
      turn.durationMs = new Date(lastStep.timestamp).getTime() + lastStep.durationMs - new Date(firstTs).getTime();
    } else if (firstTs && lastStep?.timestamp && firstTs !== lastStep.timestamp) {
      turn.durationMs = new Date(lastStep.timestamp).getTime() - new Date(firstTs).getTime();
    }
  }

  const toolAggregates = Object.entries(toolCountMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const toolCombinations: ToolCombination[] = [...comboCounts.values()]
    .sort((a, b) => b.count - a.count);

  const cost = calculateCost(model, tokens);
  const totalToolCount = Object.values(toolCountMap).reduce((a, b) => a + b, 0);

  // Build flow graph
  const firstTs = parsed.find(e => e.timestamp)?.timestamp || null;
  const lastTs = [...parsed].reverse().find(e => e.timestamp)?.timestamp || null;
  const sessionDuration = firstTs && lastTs
    ? new Date(lastTs).getTime() - new Date(firstTs).getTime()
    : null;

  const flowGraph: FlowNode = {
    id: sessionId,
    type: 'session',
    label: cwd ? cwd.replace(/^\/Users\/[^/]+/, '~') : sessionId,
    model,
    turnNumber: 0,
    timestamp: firstTs || undefined,
    tokens,
    cost: cost.total,
    toolCount: totalToolCount,
    durationMs: sessionDuration ?? undefined,
    children: [],
  };

  // Add agent spawns as children (sorted by turn number)
  for (const spawn of subagentSpawns) {
    const agentNode: FlowNode = {
      id: spawn.agentId || spawn.id,
      type: 'agent',
      label: spawn.description || spawn.id,
      model: spawn.model,
      turnNumber: spawn.turnNumber,
      timestamp: spawn.timestamp,
      children: [],
    };
    flowGraph.children.push(agentNode);
  }

  // Add skill invocations as children
  for (const skill of skills) {
    const skillNode: FlowNode = {
      id: `skill-${skill.name}-${skill.turnNumber}`,
      type: 'skill',
      label: skill.name,
      turnNumber: skill.turnNumber,
      children: [],
    };
    flowGraph.children.push(skillNode);
  }

  // Sort children by turn number
  flowGraph.children.sort((a, b) => a.turnNumber - b.turnNumber);

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
    flowGraph,
  };
}
