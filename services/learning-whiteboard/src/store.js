import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, rename, readdir, rm } from 'node:fs/promises';
import lockfile from 'proper-lockfile';
import { z } from 'zod';

export const MAX_BOARD_BYTES = 8 * 1024 * 1024;
export const MAX_ELEMENTS = 10000;
export const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
const finite = z.number().finite();
const elementSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame', 'magicframe', 'embeddable', 'iframe', 'selection']),
  x: finite,
  y: finite,
  width: finite.nonnegative(),
  height: finite.nonnegative(),
  text: z.string().max(100000).optional(),
  link: z.string().max(10000).nullable().optional(),
  isDeleted: z.boolean().optional(),
  version: z.number().int().positive().optional(),
  points: z.array(z.tuple([finite, finite])).max(100000).optional(),
}).passthrough();
export const sceneSchema = z.object({
  type: z.literal('excalidraw'),
  version: z.literal(2),
  source: z.string().max(10000).optional(),
  elements: z.array(elementSchema).max(MAX_ELEMENTS),
  appState: z.record(z.string(), z.unknown()).optional(),
  files: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export const regionsSchema = z.object({
  canvas: z.tuple([finite, finite, finite.positive(), finite.positive()]).optional(),
  regions: z.array(z.object({
    id: idSchema,
    label: z.string().min(1).max(300),
    bounds: z.tuple([finite, finite, finite.positive(), finite.positive()]),
    anchorIds: z.array(z.string().max(300)).max(1000).optional(),
    elementIds: z.array(z.string().max(200)).max(MAX_ELEMENTS).optional(),
  }).passthrough()).max(500),
}).passthrough();
export const emptyScene = () => ({ type: 'excalidraw', version: 2, source: 'learning-whiteboard-mcp', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} });

export class BoardError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function checked(schema, value, name) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new BoardError('VALIDATION_ERROR', `Invalid ${name}: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).slice(0, 8).join('; ')}`);
  return parsed.data;
}

function json(value) {
  let encoded;
  try { encoded = JSON.stringify(value); } catch { throw new BoardError('VALIDATION_ERROR', 'Board must be JSON serializable'); }
  if (Buffer.byteLength(encoded ?? '') > MAX_BOARD_BYTES) throw new BoardError('BOARD_TOO_LARGE', `Board exceeds ${MAX_BOARD_BYTES} bytes`, 413);
  return encoded;
}

export function validateScene(value) {
  const scene = checked(sceneSchema, value, 'scene');
  const ids = new Set();
  for (const element of scene.elements) {
    if (ids.has(element.id)) throw new BoardError('DUPLICATE_ELEMENT_ID', `Duplicate element id: ${element.id}`);
    ids.add(element.id);
  }
  json(scene);
  return scene;
}

export function validateRegions(value) {
  const regions = checked(regionsSchema, value, 'regions');
  const ids = new Set();
  for (const region of regions.regions) {
    if (ids.has(region.id)) throw new BoardError('DUPLICATE_REGION_ID', `Duplicate region id: ${region.id}`);
    ids.add(region.id);
  }
  return regions;
}

export function selectElements(board, regionId, includeDeleted = false) {
  let elements = board.scene.elements.filter(element => includeDeleted || !element.isDeleted);
  if (regionId && regionId !== 'all') {
    const region = board.regions.regions.find(item => item.id === regionId);
    if (!region) throw new BoardError('REGION_NOT_FOUND', `Region not found: ${regionId}`, 404);
    const explicit = new Set(region.elementIds ?? []);
    const [rx, ry, rw, rh] = region.bounds;
    elements = elements.filter(element => explicit.has(element.id) || (
      element.x <= rx + rw && element.x + element.width >= rx && element.y <= ry + rh && element.y + element.height >= ry
    ));
  }
  return elements;
}

export function summarizeElement(element) {
  const summary = Object.fromEntries(['id', 'type', 'text', 'link', 'x', 'y', 'width', 'height', 'isDeleted'].filter(key => element[key] !== undefined).map(key => [key, element[key]]));
  if (summary.text?.length > 1000) { summary.text = `${summary.text.slice(0, 1000)}…`; summary.textTruncated = true; }
  return summary;
}

export class BoardStore {
  constructor({ dataDir = process.env.WHITEBOARD_DATA_DIR ?? 'data', seedDir = process.env.WHITEBOARD_SEED_DIR ?? 'seed', publicBaseUrl = process.env.PUBLIC_BASE_URL ?? 'https://warmhanser.com' } = {}) {
    this.dataDir = path.resolve(dataDir);
    this.boardsDir = path.join(this.dataDir, 'boards');
    this.backupsDir = path.join(this.dataDir, 'backups');
    this.lockDir = path.join(this.dataDir, '.write-lock');
    this.seedDir = path.resolve(seedDir);
    const url = new URL(publicBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_BASE_URL must use http or https');
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, '');
    this.queue = Promise.resolve();
  }

  boardPath(id) {
    checked(idSchema, id, 'board id (lowercase letters, numbers, underscore and hyphen only)');
    return path.join(this.boardsDir, `${id}.json`);
  }

  url(id, regionId) {
    this.boardPath(id);
    return `${this.publicBaseUrl}/articles/knowledge-map?whiteboard=${encodeURIComponent(id)}${regionId ? `&region=${encodeURIComponent(regionId)}` : ''}`;
  }

  async initialize() {
    await mkdir(this.boardsDir, { recursive: true });
    await mkdir(this.backupsDir, { recursive: true });
    await this.transaction(async () => {
      try { await this.get('software-atlas'); return; } catch (error) { if (error.code !== 'BOARD_NOT_FOUND') throw error; }
      let sceneText;
      try { sceneText = await readFile(path.join(this.seedDir, 'software-atlas.excalidraw'), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      let regionText;
      try { regionText = await readFile(path.join(this.seedDir, 'regions.json'), 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const now = new Date().toISOString();
      const board = {
        id: 'software-atlas', title: '软件知识白板', revision: 1,
        scene: validateScene(JSON.parse(sceneText)),
        regions: validateRegions(regionText ? JSON.parse(regionText) : { regions: [] }),
        createdAt: now, updatedAt: now,
      };
      await this.writeAtomic(this.boardPath(board.id), board);
    });
    return this;
  }

  async writeAtomic(target, value) {
    const text = json(value);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      // Flush file contents before the atomic rename. Reads see the old or the new complete JSON.
      const { open } = await import('node:fs/promises');
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
      await rename(temporary, target);
      if (process.platform !== 'win32') {
        const directory = await open(path.dirname(target), 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
    } finally { await rm(temporary, { force: true }); }
  }

  async acquireLock() {
    try {
      // Heartbeats distinguish a live transaction from a crashed container without relying on hostname or PID.
      return await lockfile.lock(this.dataDir, {
        lockfilePath: this.lockDir, realpath: false, stale: 10000, update: 2000,
        retries: { retries: 40, minTimeout: 300, maxTimeout: 500, randomize: true },
      });
    } catch (error) {
      if (error.code === 'ELOCKED') throw new BoardError('STORE_BUSY', 'Store is locked by another writer; retry later.', 503);
      throw error;
    }
  }

  transaction(operation) {
    const result = this.queue.then(async () => {
      const release = await this.acquireLock();
      try { return await operation(); } finally { await release(); }
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async get(id) {
    const target = this.boardPath(id);
    try { return JSON.parse(await readFile(target, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw new BoardError('BOARD_NOT_FOUND', `Board not found: ${id}`, 404);
      throw error;
    }
  }

  summary(board) {
    return {
      id: board.id, title: board.title, revision: board.revision,
      elementCount: board.scene.elements.filter(element => !element.isDeleted).length,
      regionCount: board.regions.regions.length, updatedAt: board.updatedAt,
      url: this.url(board.id), exportUrl: `${this.publicBaseUrl}/whiteboard/api/boards/${board.id}/export`,
    };
  }

  async list() {
    const names = (await readdir(this.boardsDir)).filter(name => /^[a-z0-9][a-z0-9_-]{0,79}\.json$/.test(name)).sort();
    return Promise.all(names.map(async name => this.summary(await this.get(name.slice(0, -5)))));
  }

  async create({ id, title, scene = emptyScene(), regions = { regions: [] } }) {
    checked(idSchema, id, 'board id');
    title = checked(z.string().trim().min(1).max(300), title, 'title');
    scene = validateScene(scene);
    regions = validateRegions(regions);
    return this.transaction(async () => {
      try { await this.get(id); throw new BoardError('BOARD_EXISTS', `Board already exists: ${id}`, 409); }
      catch (error) { if (error.code !== 'BOARD_NOT_FOUND') throw error; }
      const now = new Date().toISOString();
      const board = { id, title, revision: 1, scene, regions, createdAt: now, updatedAt: now };
      await this.writeAtomic(this.boardPath(id), board);
      return this.summary(board);
    });
  }

  async mutate(id, expectedRevision, change) {
    checked(idSchema, id, 'board id');
    checked(z.number().int().positive(), expectedRevision, 'expectedRevision');
    return this.transaction(async () => {
      const current = await this.get(id);
      if (current.revision !== expectedRevision) throw new BoardError('REVISION_CONFLICT', `Revision conflict: expected ${expectedRevision}, current ${current.revision}. Read the board again before retrying.`, 409, { expectedRevision, currentRevision: current.revision });
      const updated = await change(structuredClone(current));
      validateScene(updated.scene);
      validateRegions(updated.regions);
      updated.revision = current.revision + 1;
      updated.updatedAt = new Date().toISOString();
      // Validate total size before creating either the backup or current file.
      json(updated);
      await this.writeAtomic(path.join(this.backupsDir, id, `revision-${current.revision}.json`), current);
      await this.writeAtomic(this.boardPath(id), updated);
      return this.summary(updated);
    });
  }

  async update({ id, expectedRevision, title, upsertElements = [], removeElementIds = [], regions }) {
    if (title !== undefined) checked(z.string().trim().min(1).max(300), title, 'title');
    checked(z.array(elementSchema).max(MAX_ELEMENTS), upsertElements, 'upsertElements');
    checked(z.array(z.string().min(1).max(200)).max(MAX_ELEMENTS), removeElementIds, 'removeElementIds');
    const upsertIds = new Set(upsertElements.map(element => element.id));
    if (upsertIds.size !== upsertElements.length) throw new BoardError('DUPLICATE_ELEMENT_ID', 'upsertElements must contain unique element ids');
    if (removeElementIds.some(id => upsertIds.has(id))) throw new BoardError('AMBIGUOUS_UPDATE', 'An element cannot be both upserted and removed');
    if (regions !== undefined) regions = validateRegions(regions);
    return this.mutate(id, expectedRevision, board => {
      const removed = new Set(removeElementIds);
      const upserts = new Map(upsertElements.map(element => [element.id, element]));
      board.scene.elements = board.scene.elements.filter(element => !removed.has(element.id)).map(element => {
        const next = upserts.get(element.id);
        if (!next) return element;
        upserts.delete(element.id);
        // Upserts are complete Excalidraw elements. Bump changed element versions for safe editor reconciliation.
        return { ...next, version: Math.max(element.version ?? 1, next.version ?? 1) + 1, updated: Date.now() };
      });
      board.scene.elements.push(...upserts.values());
      if (title !== undefined) board.title = title.trim();
      if (regions !== undefined) board.regions = regions;
      return board;
    });
  }

  async replace({ id, expectedRevision, scene, regions, title }) {
    scene = validateScene(scene);
    regions = validateRegions(regions);
    if (title !== undefined) checked(z.string().trim().min(1).max(300), title, 'title');
    return this.mutate(id, expectedRevision, board => ({ ...board, scene, regions, ...(title === undefined ? {} : { title: title.trim() }) }));
  }
}
