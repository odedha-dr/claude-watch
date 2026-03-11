import blessed from 'blessed';
import type { SessionData } from '../types.js';
import { calculateCost } from '../cost.js';

export interface DetailPanelWidget {
  container: blessed.Widgets.BoxElement;
  update: (session: SessionData | null) => void;
}

function fmt(n: number): string {
  return n.toLocaleString();
}

function fmtCost(n: number): string {
  return '$' + n.toFixed(2);
}

function textBar(value: number, max: number, width: number): string {
  const filled = max > 0 ? Math.round((value / max) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
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
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
  });

  screen.append(container);

  const update = (session: SessionData | null) => {
    if (!session) {
      container.setContent('{gray-fg}No session selected{/gray-fg}');
      return;
    }

    const cost = calculateCost(session.model, session.tokens);
    const totalIn = session.tokens.input + session.tokens.cacheCreation + session.tokens.cacheRead;
    const totalTokens = totalIn + session.tokens.output;

    // Build content as a single string
    let lines: string[] = [];

    // Header
    const model = session.model || '?';
    const active = session.isActive ? '{green-fg}● active{/green-fg}' : '{gray-fg}○ idle{/gray-fg}';
    const folder = session.cwd ? session.cwd.replace(/^\/Users\/[^/]+/, '~') : '-';
    const started = session.startedAt
      ? session.startedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '-';
    lines.push(`{bold}{cyan-fg}${session.id.substring(0, 12)}{/cyan-fg}{/bold}  ${active}  {yellow-fg}${model}{/yellow-fg}  {gray-fg}${started}{/gray-fg}`);
    lines.push(`{gray-fg}${folder}{/gray-fg}`);
    lines.push('');

    // Tokens & Cost (side by side conceptually, but rendered as lines)
    lines.push('{bold}{cyan-fg}Tokens{/cyan-fg}{/bold}                          {bold}{cyan-fg}Cost{/cyan-fg}{/bold}');
    lines.push(`  Input:         {white-fg}${fmt(session.tokens.input).padStart(10)}{/white-fg}     Input:  {white-fg}${fmtCost(cost.input).padStart(8)}{/white-fg}`);
    lines.push(`  Output:        {white-fg}${fmt(session.tokens.output).padStart(10)}{/white-fg}     Output: {white-fg}${fmtCost(cost.output).padStart(8)}{/white-fg}`);
    lines.push(`  Cache create:  {white-fg}${fmt(session.tokens.cacheCreation).padStart(10)}{/white-fg}     Cache:  {white-fg}${fmtCost(cost.cacheWrite + cost.cacheRead).padStart(8)}{/white-fg}`);
    lines.push(`  Cache read:    {white-fg}${fmt(session.tokens.cacheRead).padStart(10)}{/white-fg}`);
    lines.push(`  ─────────────────────────     ─────────────`);
    lines.push(`  Total In:      {bold}{white-fg}${fmt(totalIn).padStart(10)}{/white-fg}{/bold}     {bold}Total:  {green-fg}${fmtCost(cost.total).padStart(8)}{/green-fg}{/bold}`);
    lines.push(`  Total:         {bold}{white-fg}${fmt(totalTokens).padStart(10)}{/white-fg}{/bold}`);
    lines.push('');

    // Tool calls as text bars
    const entries = Object.entries(session.toolCalls)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    if (entries.length > 0) {
      const maxCount = entries[0][1];
      const barWidth = 20;
      lines.push('{bold}{cyan-fg}Tool Calls{/cyan-fg}{/bold}');
      for (const [name, count] of entries) {
        const bar = textBar(count, maxCount, barWidth);
        lines.push(`  {white-fg}${name.padEnd(16)}{/white-fg} {cyan-fg}${bar}{/cyan-fg} ${String(count).padStart(4)}`);
      }
      lines.push('');
    }

    // Meta
    lines.push('{bold}{cyan-fg}Meta{/cyan-fg}{/bold}');
    lines.push(`  Agents: {white-fg}${session.agentSpawns}{/white-fg}  Subagents: {white-fg}${session.subagents.length}{/white-fg}  Compactions: {white-fg}${session.compactions}{/white-fg}`);

    if (session.skillInvocations.length > 0) {
      lines.push(`  Skills: {white-fg}${[...new Set(session.skillInvocations)].join(', ')}{/white-fg}`);
    }

    if (session.agentDescriptions && session.agentDescriptions.length > 0) {
      lines.push('');
      lines.push('{bold}{cyan-fg}Agent Descriptions{/cyan-fg}{/bold}');
      for (const desc of session.agentDescriptions) {
        lines.push(`  {gray-fg}›{/gray-fg} {white-fg}${desc}{/white-fg}`);
      }
    }

    container.setContent(lines.join('\n'));
  };

  return { container, update };
}
