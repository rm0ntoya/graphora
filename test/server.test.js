import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../lib/server.js';
import { writeJSON, readJSON, output } from '../lib/storage.js';
import { scanProject, recordMemory } from '../lib/graph.js';

test('loopback API, origin checks, source bounds and live updates', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graphora-server-'));
  process.env.GRAPHORA_HOME = path.join(root, 'registry');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'server-fixture' }));
  await fs.writeFile(path.join(root, 'main.ts'), 'export const firstValue = () => 1;\n');
  await writeJSON(path.join(output(root), 'config.json'), { discover: false });
  let instance;
  try { instance = await startServer(root, { port: 0, watch: true }); }
  catch (error) { await fs.rm(root, { recursive: true, force: true }); throw error; }
  t.after(async () => { await instance.close(); await fs.rm(root, { recursive: true, force: true }); });
  await instance.refresh();
  const { url } = instance;
  const get = async route => (await fetch(url + route)).json();
  const initial = await get('/api/graph');
  assert.equal(initial.project.name, 'server-fixture');
  const source = initial.nodes.find(node => node.label === 'firstValue');
  assert.match((await get('/api/source?node=' + source.id)).text, /firstValue/);
  assert.equal((await fetch(url + '/api/source?node=../../etc/passwd')).status, 404);
  assert.equal((await fetch(url + '/api/refresh', { method: 'POST', headers: { Origin: 'https://example.com', 'X-Graphora-Client': 'local' } })).status, 403);
  const tokens = await fetch(url + '/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Graphora-Client': 'local' }, body: JSON.stringify({ question: 'firstValue', budget: 128 }) }).then(response => response.json());
  assert.ok(tokens.tokens <= 128);
  await fs.writeFile(path.join(root, 'main.ts'), 'export const changedValue = () => 2;\n');
  async function waitFor(check) { for (let attempt = 0; attempt < 60; attempt++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); } throw new Error('Live update timed out'); }
  await waitFor(async () => (await get('/api/graph')).nodes.some(node => node.label === 'changedValue'));
  await recordMemory(root, { kind: 'preference', title: 'Readable UI', text: 'Use readable control labels.', basis: 'explicit', author: 'user' });
  assert.ok((await readJSON(path.join(output(root), 'project', 'graph.json'))).nodes.some(node => node.label === 'Readable UI'), 'Standalone memory must persist in graph');
  await waitFor(async () => (await get('/api/graph')).nodes.some(node => node.label === 'Readable UI'));
  const health = await get('/api/health');
  assert.equal(health.watching, true); assert.equal(health.graphora, true); assert.ok(health.generatedAt);
});
