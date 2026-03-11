#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';
import { discoverProjects } from './discovery.js';
import { SessionWatcher } from './watcher.js';
import { createWebServer } from './web/server.js';
import { startApp } from './tui/app.js';

async function resolveProjectPaths(options: { project?: string; all?: boolean }): Promise<string[]> {
  if (options.project) {
    return [resolve(options.project)];
  }

  const projects = await discoverProjects();

  if (projects.length === 0) {
    console.error('No Claude Code projects found in ~/.claude/projects/');
    process.exit(1);
  }

  if (options.all) {
    return projects.map(p => p.path);
  }

  // Auto-detect: match cwd against known project paths
  // ~/.claude/projects/ dirs are encoded as -Users-odedha-foo (leading dash kept)
  // and may have worktree suffixes like --claude-worktrees-<name>
  const cwd = process.cwd();
  const cwdEncoded = '-' + cwd.replace(/\//g, '-').replace(/^-/, '');

  // Find all matching projects (main + worktree variants), pick the one with most sessions
  const matches = projects.filter(p => {
    const dirName = p.path.split('/').pop() || '';
    return dirName === cwdEncoded || dirName.startsWith(cwdEncoded + '-');
  });

  if (matches.length > 0) {
    // Prefer the one with most sessions (likely the most active)
    matches.sort((a, b) => b.sessionCount - a.sessionCount);
    return [matches[0].path];
  }

  // Fallback: most recent project (first in sorted list)
  console.log(`No project match for cwd, using: ${projects[0].name} (${projects[0].sessionCount} sessions)`);
  return [projects[0].path];
}

const program = new Command();

program
  .name('claude-watch')
  .description('Live monitoring dashboard for Claude Code sessions')
  .version('0.1.0')
  .option('--tui', 'Launch TUI dashboard instead of web')
  .option('--port <number>', 'Web server port', '3000')
  .option('--project <path>', 'Project directory to monitor')
  .option('--all', 'Monitor all projects (default for web mode)')
  .action(async (options) => {
    // Default to --all unless a specific project is given
    if (!options.project) {
      options.all = true;
    }
    const projectPaths = await resolveProjectPaths(options);
    const watcher = new SessionWatcher(projectPaths);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await watcher.stop();
      process.exit(0);
    });

    await watcher.start();

    if (options.tui) {
      startApp(watcher);
    } else {
      const port = parseInt(options.port, 10);
      createWebServer(watcher, port);
    }
  });

program.parse();
