import { readdir, stat, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { ProjectInfo, SessionData } from './types.js';
import { parseSessionFile } from './parser.js';

export function getClaudeHome(): string {
  return join(homedir(), '.claude');
}

export function getCoworkHome(): string {
  return join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
}

export async function discoverProjects(claudeHome?: string): Promise<ProjectInfo[]> {
  const home = claudeHome || getClaudeHome();
  const projectsDir = join(home, 'projects');
  const projects: ProjectInfo[] = [];

  try {
    const entries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projPath = join(projectsDir, entry.name);
      const jsonlFiles = (await readdir(projPath)).filter(f => f.endsWith('.jsonl'));
      projects.push({
        name: entry.name.replace(/-/g, '/').replace(/^\//, ''),
        path: projPath,
        sessionCount: jsonlFiles.length,
      });
    }
  } catch {
    // No projects directory
  }

  return projects;
}

export async function discoverSessions(projectPath: string): Promise<SessionData[]> {
  const entries = await readdir(projectPath, { withFileTypes: true });
  const sessions: SessionData[] = [];
  const projectName = basename(projectPath);

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      const filePath = join(projectPath, entry.name);
      try {
        const session = await parseSessionFile(filePath, projectName);
        const fileStat = await stat(filePath);
        let latestMtime = fileStat.mtimeMs;

        // Check for subagents and track their mtimes
        const subagentDir = join(projectPath, basename(entry.name, '.jsonl'), 'subagents');
        try {
          const subFiles = (await readdir(subagentDir)).filter(f => f.endsWith('.jsonl'));
          for (const sf of subFiles) {
            const subPath = join(subagentDir, sf);
            const subStat = await stat(subPath);
            if (subStat.mtimeMs > latestMtime) {
              latestMtime = subStat.mtimeMs;
            }
            const subData = await parseSessionFile(subPath, projectName);
            session.subagents.push({
              id: basename(sf, '.jsonl'),
              tokens: { input: subData.tokens.input, output: subData.tokens.output },
              toolCalls: subData.toolCalls,
            });
          }
        } catch {
          // No subagents directory
        }

        const sixtyMinAgo = Date.now() - 60 * 60 * 1000;
        session.isActive = latestMtime > sixtyMinAgo;
        // startedAt is now set by the parser from the first JSONL entry timestamp
        // Fall back to file birthtime only if parser didn't find a timestamp
        if (!session.startedAt && fileStat.birthtimeMs) {
          session.startedAt = new Date(fileStat.birthtimeMs);
        }

        sessions.push(session);
      } catch {
        // Skip unparseable files
      }
    }
  }

  // Sort by startedAt descending (newest first)
  sessions.sort((a, b) => {
    if (!a.startedAt || !b.startedAt) return 0;
    return b.startedAt.getTime() - a.startedAt.getTime();
  });

  return sessions;
}

/** CoWork session metadata from the .json sidecar file */
interface CoworkMeta {
  sessionId: string;
  title?: string;
  model?: string;
  cwd?: string;
  createdAt?: number;
  lastActivityAt?: number;
  initialMessage?: string;
}

async function readCoworkMeta(jsonPath: string): Promise<CoworkMeta | null> {
  try {
    const content = await readFile(jsonPath, 'utf-8');
    return JSON.parse(content) as CoworkMeta;
  } catch {
    return null;
  }
}

/**
 * Discover CoWork (Claude Desktop agent mode) sessions.
 * Structure: ~/Library/Application Support/Claude/local-agent-mode-sessions/<org>/<workspace>/local_<id>/audit.jsonl
 */
export async function discoverCoworkSessions(): Promise<SessionData[]> {
  const coworkHome = getCoworkHome();
  const sessions: SessionData[] = [];

  let orgDirs: string[];
  try {
    orgDirs = (await readdir(coworkHome, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => join(coworkHome, e.name));
  } catch {
    return sessions; // No CoWork directory
  }

  for (const orgDir of orgDirs) {
    let workspaceDirs: string[];
    try {
      workspaceDirs = (await readdir(orgDir, { withFileTypes: true }))
        .filter(e => e.isDirectory())
        .map(e => join(orgDir, e.name));
    } catch {
      continue;
    }

    for (const wsDir of workspaceDirs) {
      let entries: string[];
      try {
        entries = await readdir(wsDir);
      } catch {
        continue;
      }

      // Find session directories (local_<uuid>/)
      const sessionDirs = entries.filter(e => e.startsWith('local_'));

      for (const sessionDir of sessionDirs) {
        const auditPath = join(wsDir, sessionDir, 'audit.jsonl');
        const metaPath = join(wsDir, sessionDir + '.json');

        try {
          await stat(auditPath); // check it exists
        } catch {
          continue;
        }

        try {
          const meta = await readCoworkMeta(metaPath);
          const session = await parseSessionFile(auditPath, 'cowork', 'cowork');

          // Override with metadata from sidecar JSON
          if (meta) {
            session.id = meta.sessionId || session.id;
            session.title = meta.title || meta.initialMessage?.substring(0, 80);
            if (meta.model) session.model = meta.model;
            if (meta.cwd) session.cwd = meta.cwd;
            if (meta.createdAt && !session.startedAt) {
              session.startedAt = new Date(meta.createdAt);
            }
          }

          // Activity check
          const auditStat = await stat(auditPath);
          const sixtyMinAgo = Date.now() - 60 * 60 * 1000;
          const lastActivity = meta?.lastActivityAt || auditStat.mtimeMs;
          session.isActive = lastActivity > sixtyMinAgo;

          if (!session.startedAt && auditStat.birthtimeMs) {
            session.startedAt = new Date(auditStat.birthtimeMs);
          }

          sessions.push(session);
        } catch {
          // Skip unparseable sessions
        }
      }
    }
  }

  sessions.sort((a, b) => {
    if (!a.startedAt || !b.startedAt) return 0;
    return b.startedAt.getTime() - a.startedAt.getTime();
  });

  return sessions;
}
