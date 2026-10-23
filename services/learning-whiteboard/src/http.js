import { createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BoardStore, BoardError, MAX_BOARD_BYTES } from './store.js';
import { createMcpServer, VERSION } from './mcp.js';

export async function createApp({ store, token = process.env.WHITEBOARD_MCP_TOKEN } = {}) {
  if (!token?.trim()) throw new Error('WHITEBOARD_MCP_TOKEN is required. Generate a random secret and pass it through the environment.');
  store ??= await new BoardStore().initialize();
  const tokenHash = createHash('sha256').update(token).digest();
  const app = express();
  app.disable('x-powered-by');
  const allowedOrigins = new Set([new URL(store.publicBaseUrl).origin, ...(process.env.WHITEBOARD_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)]);

  app.get('/whiteboard/health', async (_req, res, next) => {
    try {
      const boards = await store.list();
      res.set('Cache-Control', 'no-store').json({ ok: true, status: 'ok', service: 'learning-whiteboard', version: VERSION, boardCount: boards.length, revisions: Object.fromEntries(boards.map(board => [board.id, board.revision])) });
    } catch (error) { next(error); }
  });
  app.get('/whiteboard/api/boards', async (_req, res, next) => {
    try { res.set('Cache-Control', 'no-store').json({ boards: await store.list() }); }
    catch (error) { next(error); }
  });
  app.get('/whiteboard/api/boards/:id/export', async (req, res, next) => {
    try {
      const board = await store.get(req.params.id);
      res.set({ 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${board.id}.excalidraw"` }).type('application/json').send(JSON.stringify(board.scene));
    } catch (error) { next(error); }
  });
  app.get('/whiteboard/api/boards/:id', async (req, res, next) => {
    try {
      const { id, title, revision, scene, regions, updatedAt } = await store.get(req.params.id);
      res.set({ 'Cache-Control': 'no-store', ETag: `"${id}-${revision}"` }).json({ id, title, revision, scene, regions, updatedAt });
    } catch (error) { next(error); }
  });

  app.use('/whiteboard/mcp', (req, res, next) => {
    const authorization = req.get('authorization') ?? '';
    const match = /^Bearer ([^\s]+)$/i.exec(authorization);
    const providedHash = createHash('sha256').update(match?.[1] ?? '').digest();
    if (!match || !timingSafeEqual(tokenHash, providedHash)) return res.set('WWW-Authenticate', 'Bearer realm="learning-whiteboard"').status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Valid Bearer token required' } });
    const origin = req.get('origin');
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Origin is not allowed' } });
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.post('/whiteboard/mcp', express.json({ limit: MAX_BOARD_BYTES + 1024 * 1024 }), async (req, res, next) => {
    const server = createMcpServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await server.close().catch(() => {});
    };
    res.on('close', close);
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (error) { await close(); if (!res.headersSent) next(error); }
  });
  app.all('/whiteboard/mcp', (_req, res) => res.set('Allow', 'POST').status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Only POST is supported; this server uses stateless Streamable HTTP.' } }));
  app.use('/whiteboard', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Whiteboard endpoint not found' } }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    const tooLarge = error.type === 'entity.too.large';
    const invalidJson = error.type === 'entity.parse.failed';
    if (!(error instanceof BoardError) && !tooLarge && !invalidJson) console.error('Whiteboard HTTP error:', error);
    res.status(error instanceof BoardError ? error.status : tooLarge ? 413 : invalidJson ? 400 : 500).json({ error: {
      code: error instanceof BoardError ? error.code : tooLarge ? 'BODY_TOO_LARGE' : invalidJson ? 'INVALID_JSON' : 'INTERNAL_ERROR',
      message: error instanceof BoardError ? error.message : tooLarge ? 'Request body exceeds the size limit' : invalidJson ? 'Request body must be valid JSON' : 'Whiteboard service error',
      ...(error instanceof BoardError ? error.details : {}),
    } });
  });
  return app;
}

export async function start() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  const listener = app.listen(port, process.env.HOST ?? '0.0.0.0', () => console.error(`learning-whiteboard ${VERSION} listening on port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    listener.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
  return listener;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start().catch(error => { console.error(error.message); process.exitCode = 1; });
