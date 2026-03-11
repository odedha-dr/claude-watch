// Raw JSONL entry from Claude Code session logs
export interface RawEntry {
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId: string;
  version?: string;
  gitBranch?: string;
  type?: string;
  subtype?: string;
  timestamp?: string;
  message?: RawMessage;
  data?: Record<string, unknown>;
  toolUseResult?: Record<string, unknown>;
  uuid?: string;
  slug?: string;
}

export interface RawMessage {
  role: string;
  model?: string;
  id?: string;
  type?: string;
  content?: RawContent[] | string;
  usage?: TokenUsage;
}

export interface RawContent {
  type: string;
  text?: string;
  name?: string;        // tool_use name
  id?: string;          // tool_use id
  input?: Record<string, unknown>;
  thinking?: string;
  tool_use_id?: string; // tool_result
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

// Processed session data
export interface SessionData {
  id: string;
  filePath: string;
  project: string;
  model: string;
  cwd: string;
  startedAt: Date | null;
  isActive: boolean;
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  compactions: number;
  toolCalls: Record<string, number>;
  agentSpawns: number;
  skillInvocations: string[];
  subagents: SubagentData[];
  agentDescriptions: string[];
}

export interface SubagentData {
  id: string;
  tokens: { input: number; output: number };
  toolCalls: Record<string, number>;
}

export interface ProjectInfo {
  name: string;
  path: string;
  sessionCount: number;
}

export interface WatcherEvent {
  type: 'session-updated' | 'session-added' | 'session-removed';
  sessionId: string;
  data: SessionData;
}

// Turn-level tracking
export interface Turn {
  number: number;
  role: 'user' | 'assistant';
  timestamp: string | null;
  durationMs: number | null;       // time from this entry to next entry (latency)
  toolCalls: string[];
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
    totalIn: number;               // input + cacheCreation + cacheRead
  };
  // Full content for drill-down
  content: TurnContent[];
  stopReason?: string;
}

export interface TurnContent {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'other';
  text?: string;                   // for text/thinking blocks
  toolName?: string;               // for tool_use
  toolInput?: Record<string, unknown>;  // for tool_use
  toolResult?: {                   // for tool_result (from the following user entry)
    stdout?: string;
    stderr?: string;
    interrupted?: boolean;
    isImage?: boolean;
  };
}

export interface ToolCallEntry {
  name: string;
  turnNumber: number;
  input?: Record<string, unknown>;
}

export interface SubagentSpawn {
  id: string;
  description: string;
  model?: string;
  turnNumber: number;
}

export interface SkillInvocation {
  name: string;
  turnNumber: number;
  args?: string;
}

export interface ToolCombination {
  tools: string[];
  count: number;
}

export interface SessionDetail {
  id: string;
  project: string;
  model: string;
  cwd: string;
  startedAt: Date | null;
  isActive: boolean;
  tokens: {
    input: number;
    output: number;
    cacheCreation: number;
    cacheRead: number;
  };
  cost: { input: number; output: number; cacheWrite: number; cacheRead: number; total: number };
  compactions: number;
  turns: Turn[];
  toolCalls: ToolCallEntry[];
  toolAggregates: { name: string; count: number }[];
  toolCombinations: ToolCombination[];
  subagentSpawns: SubagentSpawn[];
  skills: SkillInvocation[];
  subagents: SubagentData[];
}

export interface SessionSummary {
  id: string;
  filePath: string;
  model: string;
  cwd: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  isActive: boolean;
  startedAt: string | null;
  subagentCount: number;
  skillNames: string[];
  subagentDescriptions: string[];
}
