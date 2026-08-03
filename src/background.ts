import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadSyncToken } from './sync.js';

const LABEL = 'cc.marketmaker.harness-analyzer.sync';
const MINUTES_MIN = 5;

function agentPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function launchdPlist(intervalMinutes: number): string {
  const entry = process.argv[1];
  if (!path.isAbsolute(entry)) throw new Error('Harness Analyzer must be installed before background sync can start.');
  const logRoot = path.join(os.homedir(), 'Library', 'Logs', 'HarnessAnalyzer');
  const args = [process.execPath, entry, 'sync', '--quiet'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${LABEL}</string><key>ProgramArguments</key><array>${args.map(arg => `<string>${escapeXml(arg)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>StartInterval</key><integer>${intervalMinutes * 60}</integer><key>ProcessType</key><string>Background</string><key>ThrottleInterval</key><integer>60</integer><key>StandardOutPath</key><string>${escapeXml(path.join(logRoot, 'sync.log'))}</string><key>StandardErrorPath</key><string>${escapeXml(path.join(logRoot, 'sync-error.log'))}</string></dict></plist>\n`;
}

function requireMac(): void {
  if (process.platform !== 'darwin') throw new Error('Background sync is currently available on macOS only.');
}

export function startBackgroundSync(intervalMinutes = 15): string {
  requireMac();
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < MINUTES_MIN || intervalMinutes > 1440) throw new Error('Interval must be between 5 and 1440 minutes.');
  if (!loadSyncToken() || process.env.HARNESS_ANALYZER_TOKEN) throw new Error('Background sync needs a stored login. Run "harness-analyzer login" first.');
  const file = agentPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.join(os.homedir(), 'Library', 'Logs', 'HarnessAnalyzer'), { recursive: true });
  fs.writeFileSync(file, launchdPlist(intervalMinutes), { mode: 0o600 });
  const domain = `gui/${process.getuid?.() || 501}`;
  try { execFileSync('launchctl', ['bootout', domain, file], { stdio: 'ignore' }); } catch {}
  execFileSync('launchctl', ['bootstrap', domain, file], { stdio: 'ignore' });
  return file;
}

export function stopBackgroundSync(): boolean {
  requireMac();
  const file = agentPath();
  if (!fs.existsSync(file)) return false;
  const domain = `gui/${process.getuid?.() || 501}`;
  try { execFileSync('launchctl', ['bootout', domain, file], { stdio: 'ignore' }); } catch {}
  fs.unlinkSync(file);
  return true;
}

export function backgroundSyncStatus(): { installed: boolean; path: string } {
  return { installed: fs.existsSync(agentPath()), path: agentPath() };
}
