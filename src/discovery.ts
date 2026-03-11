import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { ProjectInfo, SessionData } from './types.js';
import { parseSessionFile } from './parser.js';

export function getClaudeHome(): string {
  return join(homedir(), '.claude');
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

        const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
        session.isActive = latestMtime > thirtyMinAgo;
        session.startedAt = fileStat.birthtimeMs ? new Date(fileStat.birthtimeMs) : null;

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
