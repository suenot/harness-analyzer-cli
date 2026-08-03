import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPublicSnapshot, collect, type CollectorResult, type PublicSnapshotV1 } from '@claude-stats/core';

export const DEFAULT_API_URL = 'https://harness-analyzer-api.marketmaker.cc/api';

interface SharingSettings {
  handle: string;
  visibility: 'private' | 'totals' | 'details';
  snapshot_generated_at: string | null;
}

export interface SyncResult {
  handle: string;
  level: 'totals' | 'details';
  snapshot: PublicSnapshotV1;
  sourceResults: Record<string, number>;
  uploaded: boolean;
}

export class SyncApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SyncApiError';
  }
}

function credentialsPath(): string {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configRoot, 'harness-analyzer', 'credentials.json');
}

export function loadSyncToken(): string | null {
  if (process.env.HARNESS_ANALYZER_TOKEN) return process.env.HARNESS_ANALYZER_TOKEN.trim();
  try {
    const data = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8')) as { token?: unknown };
    return typeof data.token === 'string' ? data.token : null;
  } catch {
    return null;
  }
}

export function saveSyncToken(token: string): void {
  if (!/^ha_sync_[A-Za-z0-9_-]{40,}$/.test(token)) throw new Error('Invalid sync token format.');
  const file = credentialsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ token }, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function removeSyncToken(): boolean {
  try {
    fs.unlinkSync(credentialsPath());
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function apiRequest<T>(
  token: string,
  apiUrl: string,
  pathname: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Sync ${token}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetcher(`${apiUrl.replace(/\/$/, '')}${pathname}`, { ...init, headers });
  const payload = await response.clone().json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    const message = payload?.error || `API request failed (${response.status})`;
    throw new SyncApiError(response.status, message);
  }
  return payload as T;
}

export async function getSyncStatus(options: {
  token: string;
  apiUrl?: string;
  fetcher?: typeof fetch;
}): Promise<SharingSettings> {
  return apiRequest<SharingSettings>(
    options.token,
    options.apiUrl || DEFAULT_API_URL,
    '/me/sharing',
    {},
    options.fetcher,
  );
}

export async function syncUsage(options: {
  token?: string;
  apiUrl?: string;
  level?: 'totals' | 'details';
  dryRun?: boolean;
  fetcher?: typeof fetch;
  collector?: () => CollectorResult;
} = {}): Promise<SyncResult> {
  const collectorResult = (options.collector || (() => collect({ verbose: false })))();
  let sharing: SharingSettings = { handle: '', visibility: 'details', snapshot_generated_at: null };
  const token = options.token || loadSyncToken();
  if (!options.dryRun) {
    if (!token) throw new Error('Not connected. Run "harness-analyzer login" first.');
    sharing = await getSyncStatus({ token, apiUrl: options.apiUrl, fetcher: options.fetcher });
  }
  const level = options.level || (sharing.visibility === 'totals' ? 'totals' : 'details');
  const snapshot = buildPublicSnapshot(collectorResult.sessions, level);
  if (!options.dryRun) {
    await apiRequest(
      token!,
      options.apiUrl || DEFAULT_API_URL,
      '/me/public-snapshot',
      { method: 'PUT', body: JSON.stringify(snapshot) },
      options.fetcher,
    );
  }
  return {
    handle: sharing.handle,
    level,
    snapshot,
    sourceResults: collectorResult.sourceResults,
    uploaded: !options.dryRun,
  };
}
