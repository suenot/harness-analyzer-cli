import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadSyncToken, removeSyncToken, saveSyncToken, syncUsage } from '../dist/sync.js';

const session = {
  date: '2026-08-03', time: '10:00', source: 'Codex', file: '/secret/file.jsonl',
  cost: 1.25, input_tokens: 100, output_tokens: 20, cache_read: 50, cache_write: 10,
  model: 'gpt-5.6-sol', title: 'secret title', cwd: '/secret/project',
  history: [{ role: 'user', text: 'secret prompt' }],
  hours: { 10: { cost: 1.25, input_tokens: 100, output_tokens: 20, cache_read: 50, cache_write: 10 } },
};

test('sync uploads only an aggregate snapshot', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/me/sharing')) return Response.json({ handle: 'alice', visibility: 'details', snapshot_generated_at: null });
    return Response.json({ ok: true, generated_at: 'now' });
  };
  const result = await syncUsage({
    token: `ha_sync_${'a'.repeat(43)}`,
    apiUrl: 'https://api.example.test/api',
    fetcher,
    collector: () => ({ sessions: [session], summary: {}, sourceResults: { Codex: 1 } }),
  });
  assert.equal(result.uploaded, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.get('Authorization').startsWith('Sync ha_sync_'), true);
  const body = calls[1].init.body;
  for (const secret of ['/secret/file.jsonl', '/secret/project', 'secret prompt', 'secret title']) {
    assert.equal(body.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(JSON.parse(body).totals.total_tokens, 180);
});

test('dry run makes no network request', async () => {
  const result = await syncUsage({
    dryRun: true,
    fetcher: async () => { throw new Error('network should not be called'); },
    collector: () => ({ sessions: [session], summary: {}, sourceResults: { Codex: 1 } }),
  });
  assert.equal(result.uploaded, false);
  assert.equal(result.level, 'details');
});

test('credentials are stored with owner-only permissions', () => {
  const originalConfig = process.env.XDG_CONFIG_HOME;
  const originalToken = process.env.HARNESS_ANALYZER_TOKEN;
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-analyzer-test-'));
  process.env.XDG_CONFIG_HOME = configRoot;
  delete process.env.HARNESS_ANALYZER_TOKEN;
  try {
    const token = `ha_sync_${'b'.repeat(43)}`;
    saveSyncToken(token);
    const file = path.join(configRoot, 'harness-analyzer', 'credentials.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(loadSyncToken(), token);
    assert.equal(removeSyncToken(), true);
    assert.equal(removeSyncToken(), false);
  } finally {
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfig;
    if (originalToken === undefined) delete process.env.HARNESS_ANALYZER_TOKEN;
    else process.env.HARNESS_ANALYZER_TOKEN = originalToken;
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});
