// Boots the REAL app (createApp, real routes, real auth, real migration runner) against a fresh
// in-memory Postgres (PGlite - genuine Postgres compiled to WebAssembly), so the tests exercise the
// same SQL that runs on Neon without touching it. Also counts every query and the bytes it returned,
// which is what the usage-budget tests assert on.
import crypto from 'node:crypto';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { __setPoolForTests } from '../../server/db/pgPool.js';
import { getDb } from '../../server/db/index.js';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';

// node-postgres returns int8 (COUNT(*), SUM over bigint) as strings; PGlite returns BigInt, which
// res.json() can't serialize. Mirror pg's behaviour so tests see exactly what production sees.
function normalizeRows(rows) {
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? v.toString() : v;
    return out;
  });
}

export async function startTestApp() {
  const pg = new PGlite();
  const stats = { queries: 0, bytes: 0, log: [] };

  const query = async (sql, params) => {
    let result;
    if (params && params.length) {
      result = await pg.query(sql, params);
    } else {
      // Parameterless SQL may be a whole migration file (several statements) - exec handles that.
      const results = await pg.exec(sql);
      result = results[results.length - 1] || { rows: [], affectedRows: 0 };
    }
    const rows = normalizeRows(result.rows || []);
    stats.queries++;
    stats.bytes += JSON.stringify(rows).length;
    stats.log.push(sql);
    return { rows, rowCount: result.affectedRows ?? rows.length };
  };

  // Shaped like a node-postgres Pool: what getDb(), runMigrations() and withTransaction() use.
  __setPoolForTests({
    query,
    connect: async () => ({ query, release() {} }),
    on() {},
    end: async () => {}
  });
  await getDb(); // runs the real migrations + seed through the app's own boot path

  const app = createApp();
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const createUser = async (name, role, { deactivated = false } = {}) => {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}@degreebaba.com`;
    const { rows } = await query(
      'INSERT INTO users (name, email, password_hash, role, deactivated_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role',
      [name, email, 'not-a-real-hash', role, deactivated ? '2020-01-01T00:00:00Z' : null]
    );
    const token = crypto.randomBytes(16).toString('hex');
    await query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, iso_future(24))", [token, rows[0].id]);
    return { ...rows[0], cookie: `sid=${token}` };
  };

  const api = async (user, method, path, body) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { cookie: user.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const resetStats = () => { stats.queries = 0; stats.bytes = 0; stats.log = []; };

  // closeAllConnections: fetch keeps sockets alive, and server.close() alone waits for them.
  const close = async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pg.close();
  };

  return { query, api, createUser, stats, resetStats, close, config, baseUrl };
}

// Stand-in for the Python image_pipeline service: records every call so tests can prove exactly
// how many (paid) generations got through, and can be told to respond slowly.
export async function startImagePipelineStub({ delayMs = 0 } = {}) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    calls.push(`${req.method} ${req.path}`);
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    next();
  });
  app.post('/generate-images', (req, res) => res.json({ job_id: calls.length, status: 'processing' }));
  app.post('/regenerate-image', (req, res) => res.json({ image_id: req.body.image_id, version_id: 1, status: 'succeeded' }));
  app.get('/generation-status', (req, res) => res.status(404).json({ detail: 'No generation job found for external_ref' }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  config.imagePipeline.baseUrl = url;
  return { calls, url, close: () => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); } };
}

// A specialization's facts filled in enough to pass validateState (every required field).
export async function completeSpecializationFormData(overrides = {}) {
  const { schemas, getInitialState } = await import('../../src/config/schemas.js');
  const data = getInitialState('specialization');
  schemas.specialization.sections.forEach(sec => sec.fields.forEach(f => {
    if (f.required) data[f.key] = f.type === 'REPEATER' ? [] : 'Test value';
  }));
  return { ...data, spec_name: 'Online MBA in Marketing Management', university_name: 'Test University Online', ...overrides };
}
