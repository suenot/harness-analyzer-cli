import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { getDeviceMetadata, loadSyncToken, removeSyncToken, saveSyncToken, syncUsage, validateDeviceName } from '../dist/sync.js';

const session = {
  date: '2026-08-03', time: '10:00', source: 'Codex', file: '/secret/file.jsonl',
  cost: 1.25, input_tokens: 100, output_tokens: 20, cache_read: 50, cache_write: 10,
  model: 'gpt-5.6-sol', title: 'secret title', cwd: '/secret/project',
  history: [{ role: 'user', text: 'secret prompt' }],
  hours: { 10: { cost: 1.25, input_tokens: 100, output_tokens: 20, cache_read: 50, cache_write: 10 } },
};

async function withTemporaryConfig(run) {
  const originalConfig = process.env.XDG_CONFIG_HOME;
  const originalDeviceName = process.env.HARNESS_ANALYZER_DEVICE_NAME;
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-analyzer-test-'));
  process.env.XDG_CONFIG_HOME = configRoot;
  delete process.env.HARNESS_ANALYZER_DEVICE_NAME;
  try {
    return await run(configRoot);
  } finally {
    if (originalConfig === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfig;
    if (originalDeviceName === undefined) delete process.env.HARNESS_ANALYZER_DEVICE_NAME;
    else process.env.HARNESS_ANALYZER_DEVICE_NAME = originalDeviceName;
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
}

test('sync uploads a private redacted snapshot to the owner endpoint', async () => {
  await withTemporaryConfig(async () => {
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
      deviceName: 'worker-01',
      collector: () => ({ sessions: [session], summary: {}, sourceResults: { Codex: 1 } }),
    });
    assert.equal(result.uploaded, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.headers.get('Authorization').startsWith('Sync ha_sync_'), true);
    const body = calls[1].init.body;
    for (const secret of ['/secret/file.jsonl', '/secret/project', 'secret prompt', 'secret title']) {
      assert.equal(body.includes(secret), false, `leaked ${secret}`);
    }
    assert.equal(calls[1].url.endsWith('/me/analytics'), true);
    assert.equal(JSON.parse(body).sessions[0].file, 'remote');
    assert.equal(JSON.parse(body).sessions[0].cost, 1.25);
    assert.equal(JSON.parse(body).device.name, 'worker-01');
    assert.match(JSON.parse(body).device.id, /^[0-9a-f-]{36}$/);
    assert.equal(JSON.parse(body).device.platform, process.platform);
    assert.equal(JSON.parse(body).device.architecture, process.arch);
  });
});

test('dry run makes no network request', async () => {
  await withTemporaryConfig(async () => {
    const result = await syncUsage({
      dryRun: true,
      fetcher: async () => { throw new Error('network should not be called'); },
      collector: () => ({ sessions: [session], summary: {}, sourceResults: { Codex: 1 } }),
    });
    assert.equal(result.uploaded, false);
    assert.equal(result.level, 'details');
  });
});

test('device identity stays stable across sync token logout', async () => {
  await withTemporaryConfig(async configRoot => {
    const first = getDeviceMetadata();
    const second = getDeviceMetadata();
    assert.equal(second.id, first.id);
    assert.equal(second.name, first.name);

    saveSyncToken(`ha_sync_${'c'.repeat(43)}`);
    assert.equal(removeSyncToken(), true);
    const afterLogout = getDeviceMetadata();
    assert.equal(afterLogout.id, first.id);

    const file = path.join(configRoot, 'harness-analyzer', 'device.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.existsSync(path.join(configRoot, 'harness-analyzer', 'credentials.json')), false);
  });
});

test('CLI device name persists while the environment override is temporary', async () => {
  await withTemporaryConfig(async () => {
    process.env.HARNESS_ANALYZER_DEVICE_NAME = 'temporary-worker';
    const explicit = getDeviceMetadata({ deviceName: 'persistent-worker' });
    assert.equal(explicit.name, 'persistent-worker');

    const temporary = getDeviceMetadata();
    assert.equal(temporary.name, 'temporary-worker');
    assert.equal(temporary.id, explicit.id);

    delete process.env.HARNESS_ANALYZER_DEVICE_NAME;
    const persisted = getDeviceMetadata();
    assert.equal(persisted.name, 'persistent-worker');
    assert.equal(persisted.id, explicit.id);
  });
});

test('device names reject blanks, excessive length and control characters', () => {
  for (const name of ['', '   ', 'a'.repeat(81), 'worker\n01']) {
    assert.throws(() => validateDeviceName(name), /Device name must be 1-80 characters/);
  }
  assert.equal(validateDeviceName(' worker-01 '), 'worker-01');
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
