import blessed from 'blessed';
import contrib from 'blessed-contrib';
import type { SessionData } from '../types.js';

export interface DetailPanelWidget {
  container: blessed.Widgets.BoxElement;
  update: (session: SessionData | null) => void;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

export function createDetailPanel(screen: blessed.Widgets.Screen): DetailPanelWidget {
  const container = blessed.box({
    top: '40%',
    left: 0,
    width: '100%',
    height: '60%',
    label: ' Detail ',
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
    },
    scrollable: true,
    alwaysScroll: true,
  });

  screen.append(container);

  const tokenBox = blessed.box({
    parent: container,
    top: 0,
    left: 0,
    width: '40%',
    height: '70%',
    padding: { left: 1, top: 0 },
  });

  const barBox = blessed.box({
    parent: container,
    top: 0,
    left: '40%',
    width: '60%',
    height: '70%',
  });

  let barChart: ReturnType<typeof contrib.bar> | null = null;

  const metaBox = blessed.box({
    parent: container,
    top: '70%',
    left: 0,
    width: '100%',
    height: '30%',
    padding: { left: 1 },
  });

  const update = (session: SessionData | null) => {
    if (!session) {
      tokenBox.setContent('{gray-fg}No session selected{/gray-fg}');
      if (barChart) { barChart.detach(); barChart = null; }
      metaBox.setContent('');
      screen.render();
      return;
    }

    // Token breakdown
    const total = session.tokens.input + session.tokens.output +
      session.tokens.cacheCreation + session.tokens.cacheRead;
    tokenBox.setContent(
      `{bold}{cyan-fg}Tokens{/cyan-fg}{/bold}\n` +
      `\n` +
      `  Input:         {white-fg}${fmt(session.tokens.input)}{/white-fg}\n` +
      `  Output:        {white-fg}${fmt(session.tokens.output)}{/white-fg}\n` +
      `  Cache created: {white-fg}${fmt(session.tokens.cacheCreation)}{/white-fg}\n` +
      `  Cache read:    {white-fg}${fmt(session.tokens.cacheRead)}{/white-fg}\n` +
      `  ─────────────────────\n` +
      `  Total:         {bold}{white-fg}${fmt(total)}{/white-fg}{/bold}`
    );
    tokenBox.options.tags = true;
    (tokenBox as any).parseTags = true;

    // Tool call bar chart
    const entries = Object.entries(session.toolCalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    if (barChart) { barChart.detach(); barChart = null; }

    if (entries.length > 0) {
      barChart = contrib.bar({
        parent: barBox,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        label: ' Tool Calls ',
        barWidth: 6,
        barSpacing: 2,
        maxHeight: Math.max(...entries.map(e => e[1])),
        xOffset: 0,
        style: { fg: 'cyan' },
        border: { type: 'line' },
      } as any);

      barChart.setData({
        titles: entries.map(e => e[0].substring(0, 6)),
        data: entries.map(e => e[1]),
      });
    }

    // Meta info
    const skills = session.skillInvocations.length > 0
      ? session.skillInvocations.join(', ')
      : '-';
    metaBox.setContent(
      `{bold}{cyan-fg}Meta{/cyan-fg}{/bold}  ` +
      `Agents: {white-fg}${session.agentSpawns}{/white-fg}  ` +
      `Skills: {white-fg}${skills}{/white-fg}  ` +
      `Subagents: {white-fg}${session.subagents.length}{/white-fg}  ` +
      `Compactions: {white-fg}${session.compactions}{/white-fg}`
    );
    metaBox.options.tags = true;
    (metaBox as any).parseTags = true;

    screen.render();
  };

  return { container, update };
}
