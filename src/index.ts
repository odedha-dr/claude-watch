#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'path';
import { discoverProjects } from './discovery.js';
import { SessionWatcher } from './watcher.js';
import { createWebServer } from './web/server.js';
import { startApp } from './tui/app.js';

async function resolveProjectPath(options: { project?: string; all?: boolean }): Promise<string> {
  if (options.project) {
    return resolve(options.project);
  }

  const projects = await discoverProjects();

  if (projects.length === 0) {
    console.error('No Claude Code projects found in ~/.claude/projects/');
    process.exit(1);
  }

  if (options.all) {
    // For --all, use the first project for now (multi-project is out of scope for v1)
    console.log(`Found ${projects.length} projects, using first: ${projects[0].name}`);
    return projects[0].path;
  }

  // Auto-detect: match cwd against known project paths
  const cwd = process.cwd();
  const cwdEncoded = cwd.replace(/\//g, '-').replace(/^-/, '');

  const match = projects.find(p => {
    const dirName = p.path.split('/').pop() || '';
    return dirName === cwdEncoded;
  });

  if (match) {
    return match.path;
  }

  // Fallback: most recent project (first in sorted list)
  console.log(`No project match for cwd, using: ${projects[0].name} (${projects[0].sessionCount} sessions)`);
  return projects[0].path;
}

const program = new Command();

program
  .name('claude-watch')
  .description('Live monitoring dashboard for Claude Code sessions')
  .version('0.1.0')
  .option('--web', 'Launch web dashboard instead of TUI')
  .option('--port <number>', 'Web server port', '3000')
  .option('--project <path>', 'Project directory to monitor')
  .option('--all', 'Monitor all projects')
  .action(async (options) => {
    const projectPath = await resolveProjectPath(options);
    const watcher = new SessionWatcher(projectPath);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await watcher.stop();
      process.exit(0);
    });

    await watcher.start();

    if (options.web) {
      const port = parseInt(options.port, 10);
      createWebServer(watcher, port);
    } else {
      startApp(watcher);
    }
  });

program.parse();
