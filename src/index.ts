#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { collect } from '@claude-stats/core';
import type { Session } from '@claude-stats/core';
import { createSummaryTable, createSessionsTable, createSourceTable, createProjectsTable } from './ui/table.js';
import { DEFAULT_API_URL, getSyncStatus, loadSyncToken, removeSyncToken, saveSyncToken, syncUsage } from './sync.js';

const program = new Command();

program
  .name('harness-analyzer')
  .description('Harness Analyzer usage telemetry')
  .version('0.2.0');

function readHiddenToken(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return new Promise((resolve, reject) => {
      let value = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => { value += chunk; });
      process.stdin.on('end', () => resolve(value.trim()));
      process.stdin.on('error', reject);
    });
  }
  return new Promise((resolve, reject) => {
    process.stdout.write('Paste the sync token from Profile: ');
    const input = process.stdin;
    const wasRaw = input.isRaw;
    let value = '';
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
    };
    const onData = (chunk: string) => {
      if (chunk === '\u0003') {
        cleanup();
        process.stdout.write('\n');
        reject(new Error('Login cancelled.'));
      } else if (chunk === '\r' || chunk === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(value.trim());
      } else if (chunk === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += chunk;
      }
    };
    input.on('data', onData);
  });
}

function getResult() {
  return collect({ verbose: false });
}

program
  .command('login')
  .description('Connect this computer with a sync token from your Profile page')
  .option('--api-url <url>', 'Override the hosted API URL', DEFAULT_API_URL)
  .action(async opts => {
    const token = await readHiddenToken();
    const status = await getSyncStatus({ token, apiUrl: opts.apiUrl });
    saveSyncToken(token);
    console.log(chalk.green(`Connected as @${status.handle}.`));
  });

program
  .command('sync')
  .description('Collect local usage and upload aggregate statistics')
  .option('--level <level>', 'Snapshot detail level: totals or details')
  .option('--dry-run', 'Collect and validate without uploading')
  .option('--json', 'Print the result as JSON')
  .option('--api-url <url>', 'Override the hosted API URL', DEFAULT_API_URL)
  .action(async opts => {
    if (opts.level && !['totals', 'details'].includes(opts.level)) throw new Error('Level must be totals or details.');
    const result = await syncUsage({ apiUrl: opts.apiUrl, level: opts.level, dryRun: opts.dryRun });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const totals = result.snapshot.totals;
    console.log(chalk.bold(result.uploaded ? '\nSync complete\n' : '\nDry run complete\n'));
    console.log(`${totals.total_sessions} sessions · ${totals.total_tokens.toLocaleString()} tokens · $${totals.total_cost.toFixed(2)}`);
    if (result.uploaded) console.log(chalk.gray(`https://harness-analyzer.marketmaker.cc/u/${result.handle}`));
  });

program
  .command('status')
  .description('Show the connected profile and last uploaded snapshot')
  .option('--api-url <url>', 'Override the hosted API URL', DEFAULT_API_URL)
  .action(async opts => {
    const token = loadSyncToken();
    if (!token) throw new Error('Not connected. Run "harness-analyzer login" first.');
    const status = await getSyncStatus({ token, apiUrl: opts.apiUrl });
    console.log(`@${status.handle} · ${status.visibility} · ${status.snapshot_generated_at || 'never synced'}`);
  });

program
  .command('logout')
  .description('Remove the sync token stored on this computer')
  .action(() => {
    console.log(removeSyncToken() ? 'Local sync token removed.' : 'No local sync token found.');
  });

program
  .command('summary')
  .alias('s')
  .description('Show usage summary (today, week, month, all-time)')
  .action(() => {
    const { summary } = getResult();
    console.log(chalk.bold('\nHarness Analyzer Summary\n'));
    console.log(createSummaryTable({
      today: summary.today_cost,
      week: summary.week_cost,
      month: summary.month_cost,
      allTime: summary.totals.grand_total,
      sessions: summary.session_counts.total,
    }));
    console.log('\n' + chalk.bold('By Source:'));
    console.log(createSourceTable(summary.totals));
  });

program
  .command('today')
  .alias('t')
  .description('Show today\'s sessions')
  .action(() => {
    const { sessions, summary } = getResult();
    const todaySessions = sessions
      .filter(s => s.date === summary.today)
      .sort((a, b) => a.time.localeCompare(b.time));
    console.log(chalk.bold(`\nToday (${summary.today}) - ${chalk.yellow('$' + summary.today_cost.toFixed(2))}\n`));
    if (todaySessions.length === 0) {
      console.log(chalk.gray('No sessions today.'));
    } else {
      console.log(createSessionsTable(todaySessions));
    }
  });

program
  .command('week')
  .alias('w')
  .description('Show this week\'s sessions')
  .action(() => {
    const { sessions, summary } = getResult();
    const today = new Date();
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(today);
    monday.setDate(diff);
    const mondayStr = monday.toISOString().split('T')[0];

    const weekSessions = sessions
      .filter(s => s.date >= mondayStr)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    console.log(chalk.bold(`\nThis Week (${mondayStr} - ${summary.today}) - ${chalk.yellow('$' + summary.week_cost.toFixed(2))}\n`));
    if (weekSessions.length === 0) {
      console.log(chalk.gray('No sessions this week.'));
    } else {
      console.log(createSessionsTable(weekSessions.slice(-50)));
      if (weekSessions.length > 50) {
        console.log(chalk.gray(`  ... and ${weekSessions.length - 50} more sessions`));
      }
    }
  });

program
  .command('month')
  .alias('m')
  .description('Show this month\'s sessions')
  .action(() => {
    const { sessions, summary } = getResult();
    const monthSessions = sessions
      .filter(s => s.date.startsWith(summary.current_month))
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    console.log(chalk.bold(`\nThis Month (${summary.current_month}) - ${chalk.yellow('$' + summary.month_cost.toFixed(2))}\n`));

    // Group by date
    const byDate: Record<string, Session[]> = {};
    for (const s of monthSessions) {
      if (!byDate[s.date]) byDate[s.date] = [];
      byDate[s.date].push(s);
    }
    for (const [date, daySessions] of Object.entries(byDate)) {
      const dayCost = daySessions.reduce((sum, s) => sum + s.cost, 0);
      console.log(chalk.bold(`  ${date}: `) + chalk.yellow(`$${dayCost.toFixed(2)}`) + chalk.gray(` (${daySessions.length} sessions)`));
    }
  });

program
  .command('projects')
  .alias('p')
  .description('Show usage grouped by project')
  .action(() => {
    const { sessions } = getResult();
    const projectMap: Record<string, { cost: number; sessions: number }> = {};
    for (const s of sessions) {
      const key = s.cwd || '(no project)';
      if (!projectMap[key]) projectMap[key] = { cost: 0, sessions: 0 };
      projectMap[key].cost += s.cost;
      projectMap[key].sessions++;
    }
    const projects = Object.entries(projectMap)
      .map(([cwd, data]) => ({ cwd, ...data }))
      .sort((a, b) => b.cost - a.cost);

    console.log(chalk.bold('\nProjects by Cost\n'));
    console.log(createProjectsTable(projects));
  });

program
  .command('sessions')
  .description('List sessions with filters')
  .option('-s, --source <source>', 'Filter by source')
  .option('-d, --date <date>', 'Filter by date (YYYY-MM-DD)')
  .option('-n, --limit <n>', 'Limit results', '20')
  .action((opts) => {
    const { sessions } = getResult();
    let filtered = sessions;
    if (opts.source) {
      filtered = filtered.filter(s => s.source.toLowerCase().includes(opts.source.toLowerCase()));
    }
    if (opts.date) {
      filtered = filtered.filter(s => s.date === opts.date);
    }
    filtered.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
    filtered = filtered.slice(0, parseInt(opts.limit));

    console.log(chalk.bold(`\nSessions (${filtered.length} shown)\n`));
    console.log(createSessionsTable(filtered));
  });

// Default: show summary
if (process.argv.length <= 2) {
  process.argv.push('summary');
}

program.parseAsync().catch(error => {
  console.error(chalk.red(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
