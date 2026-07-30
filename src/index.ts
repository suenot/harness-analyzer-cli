#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { collect } from '@claude-stats/core';
import type { Session } from '@claude-stats/core';
import { createSummaryTable, createSessionsTable, createSourceTable, createProjectsTable } from './ui/table.js';

const program = new Command();

program
  .name('claude-stats')
  .description('Harness Analyzer usage telemetry')
  .version('0.1.0');

function getResult() {
  return collect({ verbose: false });
}

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

program.parse();
