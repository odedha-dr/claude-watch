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
  message?: RawMessage;
  data?: Record<string, unknown>;
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
