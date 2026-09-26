import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { buildPrivateAnalyticsSnapshot, buildPublicSnapshot, collect, type AnalyticsDeviceMetadata, type CollectorResult, type PrivateAnalyticsSnapshotV1, type PublicSnapshotV1 } from '@harness-analyzer/core';

export const DEFAULT_API_URL = 'https://harness-analyzer-api.marketmaker.cc/api';

export type DeviceMetadata = AnalyticsDeviceMetadata;

interface StoredDeviceIdentity {
  id: string;
  name: string;
}

interface SharingSettings {
  handle: string;
  visibility: 'private' | 'totals' | 'details';
  snapshot_generated_at: string | null;
}

export interface SyncResult {
  handle: string;
  level: 'totals' | 'details';
  snapshot: PublicSnapshotV1;
  privateSnapshot: PrivateAnalyticsSnapshotV1;
  sourceResults: Record<string, number>;
  uploaded: boolean;
}

export class SyncApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'SyncApiError';
  }
}

function configDirectory(): string {
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configRoot, 'harness-analyzer');
}

function credentialsPath(): string {
  return path.join(configDirectory(), 'credentials.json');
}

function deviceIdentityPath(): string {
  return path.join(configDirectory(), 'device.json');
}

export function validateDeviceName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    throw new Error('Device name must be 1-80 characters without control characters.');
  }
  return name;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readDeviceIdentity(): StoredDeviceIdentity | null {
  try {
    const value = JSON.parse(fs.readFileSync(deviceIdentityPath(), 'utf8')) as { id?: unknown; name?: unknown };
    if (!isUuid(value.id) || typeof value.name !== 'string') return null;
    return { id: value.id, name: validateDeviceName(value.name) };
  } catch {
    return null;
  }
}

function saveDeviceIdentity(identity: StoredDeviceIdentity): void {
  const directory = configDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = deviceIdentityPath();
  fs.writeFileSync(file, JSON.stringify(identity, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function getDeviceMetadata(options: { deviceName?: string } = {}): DeviceMetadata {
  let identity = readDeviceIdentity();
  if (!identity) {
    const id = randomUUID();
    const hostname = os.hostname().trim().slice(0, 80) || `device-${id.slice(0, 8)}`;
    identity = { id, name: validateDeviceName(hostname) };
    saveDeviceIdentity(identity);
  }

  let name = identity.name;
  if (process.env.HARNESS_ANALYZER_DEVICE_NAME !== undefined) {
    name = validateDeviceName(process.env.HARNESS_ANALYZER_DEVICE_NAME);
  }
  if (options.deviceName !== undefined) {
    name = validateDeviceName(options.deviceName);
    identity = { ...identity, name };
    saveDeviceIdentity(identity);
  }

  return {
    id: identity.id,
    name,
    platform: process.platform,
    architecture: process.arch,
  };
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
  includeHistory?: boolean;
  deviceName?: string;
} = {}): Promise<SyncResult> {
  const collectorResult = (options.collector || (() => collect({ verbose: false })))();
  let sharing: SharingSettings = { handle: '', visibility: 'details', snapshot_generated_at: null };
  const token = options.token || loadSyncToken();
  if (!options.dryRun) {
    if (!token) throw new Error('Not connected. Run "harness-analyzer login" first.');
    sharing = await getSyncStatus({ token, apiUrl: options.apiUrl, fetcher: options.fetcher });
  }
  const level = options.level || (sharing.visibility === 'totals' ? 'totals' : 'details');
  const device = getDeviceMetadata({ deviceName: options.deviceName });
  const privateSnapshot = buildPrivateAnalyticsSnapshot(collectorResult.sessions, options.includeHistory, device);
  const snapshot = buildPublicSnapshot(privateSnapshot.sessions, level);
  if (!options.dryRun) {
    await apiRequest(
      token!,
      options.apiUrl || DEFAULT_API_URL,
      '/me/analytics',
      { method: 'PUT', body: JSON.stringify(privateSnapshot) },
      options.fetcher,
    );
  }
  return {
    handle: sharing.handle,
    level,
    snapshot,
    privateSnapshot,
    sourceResults: collectorResult.sourceResults,
    uploaded: !options.dryRun,
  };
}
