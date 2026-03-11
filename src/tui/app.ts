import blessed from 'blessed';
import { createSessionTable } from './sessions.js';
import { createDetailPanel } from './detail.js';
import type { SessionWatcher } from '../watcher.js';
import type { SessionData } from '../types.js';

export function startApp(watcher: SessionWatcher): void {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'claude-watch',
    fullUnicode: true,
  });

  const sessionTable = createSessionTable(screen);
  const detailPanel = createDetailPanel(screen);

  let sessions: SessionData[] = [];
  let selectedIndex = 0;

  function refresh() {
    sessions = watcher.getSessions();
    if (selectedIndex >= sessions.length) {
      selectedIndex = Math.max(0, sessions.length - 1);
    }
    sessionTable.update(sessions, selectedIndex);
    detailPanel.update(sessions[selectedIndex] || null);
    screen.render();
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
      sessionTable.update(sessions, selectedIndex);
      detailPanel.update(sessions[selectedIndex] || null);
      screen.render();
    }
  });

  screen.key(['down', 'j'], () => {
    if (selectedIndex < sessions.length - 1) {
      selectedIndex++;
      sessionTable.update(sessions, selectedIndex);
      detailPanel.update(sessions[selectedIndex] || null);
      screen.render();
    }
  });

  screen.key(['r'], () => {
    watcher.refresh();
  });

  // Initial render
  refresh();
}
