import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, utimes } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardStore, MAX_BOARD_BYTES, emptyScene, validateScene } from '../src/store.js';

const seedDir = process.env.WHITEBOARD_SEED_DIR ?? fileURLToPath(new URL('../../../public/articles/knowledge-map/', import.meta.url));
const element = (id, text = id) => ({ id, type: 'text', text, x: 1, y: 2, width: 100, height: 40, version: 1 });

async function fixture(t, { seeded = false } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'learning-whiteboard-test-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const store = await new BoardStore({ dataDir, seedDir: seeded ? seedDir : path.join(dataDir, 'no-seed') }).initialize();
  return { store, dataDir };
}

test('imports the actual 253-element seed once, preserves regions and does not overwrite later changes', async t => {
  const { store, dataDir } = await fixture(t, { seeded: true });
  const initial = await store.get('software-atlas');
  assert.equal(initial.scene.elements.length, 253);
  assert.deepEqual(initial.scene, JSON.parse(await readFile(path.join(seedDir, 'software-atlas.excalidraw'), 'utf8')));
  assert.deepEqual(initial.regions, JSON.parse(await readFile(path.join(seedDir, 'regions.json'), 'utf8')));
  await store.update({ id: initial.id, expectedRevision: 1, title: '持久化后的标题' });
  const restarted = await new BoardStore({ dataDir, seedDir }).initialize();
  assert.equal((await restarted.get('software-atlas')).title, '持久化后的标题');
  assert.equal((await restarted.get('software-atlas')).revision, 2);
  assert.equal((await restarted.get('software-atlas')).scene.elements.length, 253);
});

test('two independent writers with the same expected revision allow exactly one update', async t => {
  const { store, dataDir } = await fixture(t);
  await store.create({ id: 'race', title: 'Race', scene: { ...emptyScene(), elements: [element('kept')] } });
  const other = await new BoardStore({ dataDir, seedDir: path.join(dataDir, 'none') }).initialize();
  const writes = await Promise.allSettled([
    store.update({ id: 'race', expectedRevision: 1, upsertElements: [element('a')] }),
    other.update({ id: 'race', expectedRevision: 1, upsertElements: [element('b')] }),
  ]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = writes.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'REVISION_CONFLICT');
  assert.equal(rejected.reason.details.currentRevision, 2);
  const board = await store.get('race');
  assert.equal(board.revision, 2);
  assert.deepEqual(board.scene.elements.find(item => item.id === 'kept'), element('kept'));
  assert.equal(board.scene.elements.length, 2);
  const backup = JSON.parse(await readFile(path.join(dataDir, 'backups/race/revision-1.json'), 'utf8'));
  assert.equal(backup.revision, 1);
  assert.deepEqual(backup.scene.elements, [element('kept')]);
});

test('incremental edits preserve all untouched fields and survive a new store instance', async t => {
  const { store, dataDir } = await fixture(t);
  const original = { ...emptyScene(), appState: { viewBackgroundColor: '#FAF7F0', custom: true }, files: { opaque: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } }, elements: [element('changed'), element('kept'), element('removed')] };
  await store.create({ id: 'example', title: 'Example', scene: original, regions: { canvas: [0, 0, 1000, 1000], regions: [{ id: 'part', label: 'Part', bounds: [0, 0, 300, 300], elementIds: ['kept'] }] } });
  await store.update({ id: 'example', expectedRevision: 1, upsertElements: [element('changed', 'new text')], removeElementIds: ['removed'] });
  const restarted = await new BoardStore({ dataDir, seedDir: path.join(dataDir, 'none') }).initialize();
  const board = await restarted.get('example');
  assert.equal(board.revision, 2);
  assert.deepEqual(board.scene.appState, original.appState);
  assert.deepEqual(board.scene.files, original.files);
  assert.deepEqual(board.scene.elements.find(item => item.id === 'kept'), original.elements[1]);
  assert.equal(board.scene.elements.find(item => item.id === 'changed').text, 'new text');
  assert.equal(board.scene.elements.find(item => item.id === 'changed').version, 2);
  assert.equal(board.scene.elements.some(item => item.id === 'removed'), false);
  assert.equal(board.regions.regions[0].id, 'part');
});

test('recovers a stale transaction lock left by a crashed container without hostname/PID assumptions', async t => {
  const { store, dataDir } = await fixture(t);
  await store.create({ id: 'restart', title: 'Before crash' });
  const lockDir = path.join(dataDir, '.write-lock');
  await mkdir(lockDir);
  const old = new Date(Date.now() - 60000);
  await utimes(lockDir, old, old);
  const restarted = await new BoardStore({ dataDir, seedDir: path.join(dataDir, 'none') }).initialize();
  const updated = await restarted.update({ id: 'restart', expectedRevision: 1, title: 'Recovered' });
  assert.equal(updated.revision, 2);
});

test('rejects traversal IDs, invalid scenes, duplicate IDs and oversize data before writing', async t => {
  const { store } = await fixture(t);
  for (const id of ['../escape', '..', '/absolute', 'a/b', 'A', 'a%2fb', 'a\\b']) {
    await assert.rejects(store.get(id), error => error.code === 'VALIDATION_ERROR');
  }
  assert.throws(() => validateScene({ ...emptyScene(), elements: [element('same'), element('same')] }), error => error.code === 'DUPLICATE_ELEMENT_ID');
  assert.throws(() => validateScene({ ...emptyScene(), elements: [{ ...element('bad'), x: Infinity }] }), error => error.code === 'VALIDATION_ERROR');
  await assert.rejects(store.create({ id: 'oversize', title: 'Too big', scene: { ...emptyScene(), metadata: 'x'.repeat(MAX_BOARD_BYTES) } }), error => error.code === 'BOARD_TOO_LARGE');
  assert.deepEqual(await store.list(), []);
});

test('replacement is explicit, backed up, and still guarded by revision', async t => {
  const { store, dataDir } = await fixture(t);
  await store.create({ id: 'replace', title: 'Replace', scene: { ...emptyScene(), elements: [element('old')] } });
  await assert.rejects(store.replace({ id: 'replace', expectedRevision: 2, scene: emptyScene(), regions: { regions: [] } }), error => error.code === 'REVISION_CONFLICT');
  await store.replace({ id: 'replace', expectedRevision: 1, scene: emptyScene(), regions: { regions: [] } });
  assert.equal((await store.get('replace')).scene.elements.length, 0);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'backups/replace/revision-1.json'), 'utf8')).scene.elements[0].id, 'old');
});
