import blessed from 'blessed';
import { createSessionTable } from './sessions.js';
import { createDetailPanel } from './detail.js';
import type { SessionWatcher } from '../watcher.js';
import type { SessionData } from '../types.js';

export function startApp(
  watcher: SessionWatcher,
  options?: { initialProjectFilter?: string }
): void {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'claude-watch',
    fullUnicode: true,
  });

  const sessionTable = createSessionTable(screen);
  const detailPanel = createDetailPanel(screen);

  // Status bar at bottom
  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 1,
    tags: true,
    style: { bg: 'black', fg: 'gray' },
  });
  screen.append(statusBar);

  let sessions: SessionData[] = [];
  let selectedIndex = 0;
  let activeOnly = true;
  let projectFilter: string | undefined = options?.initialProjectFilter;

  function updateStatus() {
    const filterLabel = activeOnly ? 'active' : 'all';
    const projectLabel = projectFilter || 'all projects';
    const count = sessions.length;
    const activeCount = sessions.filter(s => s.isActive).length;
    statusBar.setContent(
      ` ${count} sessions (${activeCount} active) [${filterLabel}] [${projectLabel}]` +
      `  |  j/k:navigate  a:toggle filter  p:project  r:refresh  q:quit`
    );
  }

  function selectSession() {
    sessionTable.update(sessions, selectedIndex);
    detailPanel.update(sessions[selectedIndex] || null);
    updateStatus();
    screen.render();
  }

  function refresh() {
    sessions = watcher.getSessions(activeOnly, projectFilter);
    if (selectedIndex >= sessions.length) {
      selectedIndex = Math.max(0, sessions.length - 1);
    }
    const label = activeOnly ? ' Sessions (active) ' : ' Sessions (all) ';
    (sessionTable.table as any).setLabel(label);
    selectSession();
  }

  // Subscribe to watcher events
  watcher.on('change', () => {
    refresh();
  });

  // Key bindings
  screen.key(['q', 'C-c'], () => {
    watcher.stop().then(() => process.exit(0));
  });

  screen.key(['up', 'k'], () => {
    if (selectedIndex > 0) {
      selectedIndex--;
      selectSession();
    }
  });

  screen.key(['down', 'j'], () => {
    if (selectedIndex < sessions.length - 1) {
      selectedIndex++;
      selectSession();
    }
  });

  screen.key(['r'], () => {
    watcher.refresh();
  });

  screen.key(['a'], () => {
    activeOnly = !activeOnly;
    selectedIndex = 0;
    refresh();
  });

  screen.key(['p'], () => {
    const projects = watcher.getProjects();
    if (projects.length === 0) return;

    if (!projectFilter) {
      projectFilter = projects[0];
    } else {
      const idx = projects.indexOf(projectFilter);
      if (idx === -1 || idx === projects.length - 1) {
        projectFilter = undefined;
      } else {
        projectFilter = projects[idx + 1];
      }
    }
    selectedIndex = 0;
    refresh();
  });

  // Initial render
  refresh();
}
