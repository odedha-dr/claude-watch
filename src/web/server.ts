import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SessionWatcher } from '../watcher.js';
import { parseSessionFileDetailed } from '../parser.js';
import { calculateCost } from '../cost.js';
import type { SessionData, SessionSummary } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function toSummary(s: SessionData): SessionSummary {
  const cost = calculateCost(s.model, s.tokens);
  return {
    id: s.id,
    filePath: s.filePath,
    project: s.project,
    source: s.source,
    title: s.title,
    model: s.model,
    cwd: s.cwd,
    tokensIn: s.tokens.input + s.tokens.cacheCreation + s.tokens.cacheRead,
    tokensOut: s.tokens.output,
    cost: cost.total,
    isActive: s.isActive,
    startedAt: s.startedAt ? s.startedAt.toISOString() : null,
    subagentCount: s.subagents.length,
    skillNames: [...new Set(s.skillInvocations)],
    subagentDescriptions: s.agentDescriptions || [],
  };
}

export function createWebServer(
  watcher: SessionWatcher,
  port: number,
  options?: { initialProjectFilter?: string }
): void {
  const app = express();

  app.use(express.static(join(__dirname, 'public')));

  // SSE endpoint — streams lightweight summaries
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = () => {
      const sessions = watcher.getSessions();
      const summaries = sessions.map(toSummary);
      res.write(`data: ${JSON.stringify(summaries)}\n\n`);
    };

    send();
    watcher.on('change', send);

    req.on('close', () => {
      watcher.removeListener('change', send);
    });
  });

  // REST endpoint — lightweight summaries
  app.get('/api/sessions', (_req, res) => {
    const sessions = watcher.getSessions();
    res.json(sessions.map(toSummary));
  });

  // REST endpoint — list of discovered project names
  app.get('/api/projects', (_req, res) => {
    res.json(watcher.getProjects());
  });

  // REST endpoint — server config (initial filters, etc.)
  app.get('/api/config', (_req, res) => {
    res.json({
      initialProjectFilter: options?.initialProjectFilter || '',
    });
  });

  // Detail endpoint — full session detail (heavy, on-demand)
  app.get('/api/sessions/:id', async (req, res) => {
    const session = watcher.getSessionById(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    try {
      const detail = await parseSessionFileDetailed(session.filePath, session.project);
      // Carry over runtime fields from watcher
      detail.startedAt = session.startedAt;
      detail.isActive = session.isActive;

      // Enrich subagent data and flow graph nodes
      for (const sub of session.subagents) {
        const subDetail = detail.subagents.find(s => s.id === sub.id);
        if (!subDetail) {
          detail.subagents.push(sub);
        }

        // Enrich matching flow graph agent node with token/tool data
        const agentNode = detail.flowGraph.children.find(
          n => n.type === 'agent' && (n.id === sub.id || n.id === sub.id.replace('agent-', ''))
        );
        if (agentNode) {
          agentNode.tokens = {
            input: sub.tokens.input,
            output: sub.tokens.output,
            cacheCreation: 0,
            cacheRead: 0,
          };
          const subCost = calculateCost(agentNode.model || detail.model, {
            input: sub.tokens.input,
            output: sub.tokens.output,
            cacheCreation: 0,
            cacheRead: 0,
          });
          agentNode.cost = subCost.total;
          agentNode.toolCount = Object.values(sub.toolCalls).reduce((a, b) => a + b, 0);
        }
      }

      res.json(detail);
    } catch (err) {
      res.status(500).json({ error: 'Failed to parse session' });
    }
  });

  app.listen(port, () => {
    console.log(`claude-watch web dashboard: http://localhost:${port}`);
  });
}
