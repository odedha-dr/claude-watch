import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SessionWatcher } from '../watcher.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createWebServer(watcher: SessionWatcher, port: number): void {
  const app = express();

  app.use(express.static(join(__dirname, 'public')));

  // SSE endpoint
  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const send = () => {
      const sessions = watcher.getSessions();
      res.write(`data: ${JSON.stringify(sessions)}\n\n`);
    };

    // Send initial data
    send();

    // Send on changes
    watcher.on('change', send);

    req.on('close', () => {
      watcher.removeListener('change', send);
    });
  });

  // REST endpoint for initial load
  app.get('/api/sessions', (_req, res) => {
    res.json(watcher.getSessions());
  });

  app.listen(port, () => {
    console.log(`claude-watch web dashboard: http://localhost:${port}`);
  });
}
