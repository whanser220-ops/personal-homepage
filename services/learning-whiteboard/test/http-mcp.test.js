import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BoardStore } from '../src/store.js';
import { createApp } from '../src/http.js';

const token = 'test-only-secret-never-use-in-production';
const seedDir = process.env.WHITEBOARD_SEED_DIR ?? fileURLToPath(new URL('../../../public/articles/knowledge-map/', import.meta.url));
const payload = result => result.structuredContent ?? JSON.parse(result.content[0].text);

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'learning-whiteboard-http-test-'));
  const store = await new BoardStore({ dataDir, seedDir }).initialize();
  const app = await createApp({ store, token });
  const listener = app.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  t.after(async () => {
    await new Promise(resolve => listener.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${listener.address().port}`;
  return { store, base, dataDir };
}

async function connect(t, base) {
  const client = new Client({ name: 'whiteboard-integration-tests', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/whiteboard/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

test('HTTP requires a token at startup and rejects unauthenticated MCP reads and writes', async t => {
  const { base, store } = await fixture(t);
  await assert.rejects(createApp({ store, token: '' }), /WHITEBOARD_MCP_TOKEN/);
  for (const method of ['tools/list', 'tools/call', 'resources/list']) {
    const response = await fetch(`${base}/whiteboard/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: method === 'tools/call' ? { name: 'whiteboard_create', arguments: { id: 'unauthorized', title: 'Unauthorized' } } : {} }) });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('www-authenticate'), /Bearer/);
  }
  assert.equal((await fetch(`${base}/whiteboard/mcp`, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(`${base}/whiteboard/mcp`, { headers: { Authorization: `Bearer ${token}` } })).status, 405);
  assert.equal((await fetch(`${base}/whiteboard/mcp`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })).status, 405);
  assert.equal((await fetch(`${base}/whiteboard/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await fetch(`${base}/whiteboard/api/boards/unauthorized`)).status, 404);
});

test('real SDK client lists tools/resources, paginates seed, updates via MCP, and REST sees the committed revision', async t => {
  const { base } = await fixture(t);
  const client = await connect(t, base);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'whiteboard_update'));
  assert.equal(tools.tools.find(tool => tool.name === 'whiteboard_replace').annotations.destructiveHint, true);
  assert.equal(tools.tools.find(tool => tool.name === 'whiteboard_get').annotations.readOnlyHint, true);
  const listing = payload(await client.callTool({ name: 'whiteboard_list', arguments: {} }));
  assert.equal(listing.boards[0].id, 'software-atlas');
  assert.equal(listing.boards[0].elementCount, 253);
  const firstPage = payload(await client.callTool({ name: 'whiteboard_get', arguments: { id: 'software-atlas', limit: 2, summary: false } }));
  assert.equal(firstPage.total, 253);
  assert.equal(firstPage.nextOffset, 2);
  assert.equal(firstPage.scene.elements.length, 2);
  const regionPage = payload(await client.callTool({ name: 'whiteboard_get', arguments: { id: 'software-atlas', regionId: 'center' } }));
  assert.ok(regionPage.total > 0 && regionPage.total < 253);
  assert.match(regionPage.url, /whiteboard=software-atlas&region=center/);
  const resources = await client.listResources();
  assert.ok(resources.resources.some(resource => resource.uri === 'whiteboard://instructions'));
  assert.ok(resources.resources.some(resource => resource.uri === 'whiteboard://boards/software-atlas'));
  assert.match((await client.readResource({ uri: 'whiteboard://instructions' })).contents[0].text, /expectedRevision/);
  const full = JSON.parse((await client.readResource({ uri: 'whiteboard://boards/software-atlas' })).contents[0].text);
  assert.equal(full.scene.elements.length, 253);
  const created = payload(await client.callTool({ name: 'whiteboard_create', arguments: { id: 'test-board', title: 'MCP integration test' } }));
  assert.equal(created.revision, 1);
  const note = payload(await client.callTool({ name: 'whiteboard_add_note', arguments: { id: 'test-board', expectedRevision: 1, text: '学习白板测试\n持久化到独立服务', x: 100, y: 200 } }));
  assert.equal(note.revision, 2);
  assert.equal(note.elementIds.length, 2);
  const board = await (await fetch(`${base}/whiteboard/api/boards/test-board`)).json();
  assert.equal(board.revision, 2);
  assert.equal(board.scene.elements.length, 2);
  assert.match(board.scene.elements.find(element => element.type === 'text').text, /学习白板测试/);
  const conflict = await client.callTool({ name: 'whiteboard_update', arguments: { id: 'test-board', expectedRevision: 1, title: 'Stale write' } });
  assert.equal(conflict.isError, true);
  assert.equal(payload(conflict).error.code, 'REVISION_CONFLICT');
  assert.equal((await (await fetch(`${base}/whiteboard/api/boards/test-board`)).json()).revision, 2);
  const search = payload(await client.callTool({ name: 'whiteboard_search', arguments: { id: 'test-board', query: '学习白板' } }));
  assert.equal(search.matches.length, 1);
  const exported = await fetch(`${base}/whiteboard/api/boards/test-board/export`);
  assert.match(exported.headers.get('content-disposition'), /test-board.excalidraw/);
  assert.equal((await exported.json()).elements.length, 2);
  const health = await (await fetch(`${base}/whiteboard/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.version, '1.0.0');
  assert.equal(health.revisions['test-board'], 2);
});

test('real SDK client uses stdio without stdout diagnostics and shares the on-disk format', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'learning-whiteboard-stdio-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const client = new Client({ name: 'stdio-integration-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/stdio.js', import.meta.url))], env: { ...process.env, WHITEBOARD_DATA_DIR: dataDir, WHITEBOARD_SEED_DIR: seedDir }, stderr: 'pipe' });
  t.after(() => client.close());
  await client.connect(transport);
  const result = payload(await client.callTool({ name: 'whiteboard_get', arguments: { id: 'software-atlas', limit: 1 } }));
  assert.equal(result.total, 253);
  assert.equal(result.revision, 1);
});
