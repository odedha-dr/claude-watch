import blessed from 'blessed';
import contrib from 'blessed-contrib';
import type { SessionData } from '../types.js';
import { calculateCost } from '../cost.js';

export interface SessionTableWidget {
  table: ReturnType<typeof contrib.table>;
  update: (sessions: SessionData[], selectedIndex: number) => void;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function shortModel(model: string): string {
  if (!model) return '?';
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return model.split('-').pop() || model;
}

function shortTime(d: Date | null): string {
  if (!d) return '-';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function createSessionTable(screen: blessed.Widgets.Screen): SessionTableWidget {
  const table = contrib.table({
    top: 0,
    left: 0,
    width: '100%',
    height: '40%',
    label: ' Sessions ',
    keys: false,
    vi: false,
    interactive: true,
    columnSpacing: 2,
    columnWidth: [3, 6, 7, 7, 22, 9, 9, 7],
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      header: { fg: 'cyan', bold: true },
      cell: { fg: 'white', selected: { bg: 'blue' } },
    },
  } as any);

  screen.append(table);

  const update = (sessions: SessionData[], selectedIndex: number) => {
    const headers = ['', 'Src', 'Model', 'Time', 'Folder', 'Tok In', 'Tok Out', 'Cost'];
    const rows = sessions.map(s => {
      const tokIn = s.tokens.input + s.tokens.cacheCreation + s.tokens.cacheRead;
      const cost = calculateCost(s.model, s.tokens);
      return [
        s.isActive ? '●' : ' ',
        s.source === 'cowork' ? 'CW' : 'CC',
        shortModel(s.model),
        shortTime(s.startedAt),
        s.title || (s.cwd ? s.cwd.split('/').slice(-2).join('/') : '-'),
        formatNum(tokIn),
        formatNum(s.tokens.output),
        '$' + cost.total.toFixed(2),
      ];
    });

    table.setData({ headers, data: rows });

    if (rows.length > 0 && selectedIndex >= 0 && selectedIndex < rows.length) {
      (table as any).rows?.select(selectedIndex);
    }
  };

  return { table, update };
}
