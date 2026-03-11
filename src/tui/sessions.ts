import blessed from 'blessed';
import contrib from 'blessed-contrib';
import type { SessionData } from '../types.js';

export interface SessionTableWidget {
  table: ReturnType<typeof contrib.table>;
  update: (sessions: SessionData[], selectedIndex: number) => void;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function relTime(d: Date | null): string {
  if (!d) return '-';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  return Math.floor(hrs / 24) + 'd';
}

export function createSessionTable(screen: blessed.Widgets.Screen): SessionTableWidget {
  const table = contrib.table({
    top: 0,
    left: 0,
    width: '100%',
    height: '40%',
    label: ' Sessions ',
    keys: true,
    vi: true,
    interactive: true,
    columnSpacing: 2,
    columnWidth: [3, 14, 8, 18, 10, 10, 6, 8],
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      header: { fg: 'cyan', bold: true },
      cell: { fg: 'white', selected: { bg: 'blue' } },
    },
  } as any);

  screen.append(table);

  const update = (sessions: SessionData[], selectedIndex: number) => {
    const headers = ['#', 'Session ID', 'Started', 'Model', 'Tokens In', 'Tokens Out', 'Comp.', 'Status'];
    const rows = sessions.map((s, i) => [
      String(i + 1),
      s.id.substring(0, 12),
      relTime(s.startedAt),
      s.model || '-',
      formatNum(s.tokens.input),
      formatNum(s.tokens.output),
      String(s.compactions),
      s.isActive ? '● active' : '  idle',
    ]);

    table.setData({ headers, data: rows });

    if (rows.length > 0 && selectedIndex >= 0 && selectedIndex < rows.length) {
      (table as any).rows?.select(selectedIndex);
    }
  };

  return { table, update };
}
