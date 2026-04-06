import Table from 'cli-table3';
import chalk from 'chalk';

export function formatCost(cost: number): string {
  if (cost >= 100) return chalk.red(`$${cost.toFixed(2)}`);
  if (cost >= 10) return chalk.yellow(`$${cost.toFixed(2)}`);
  return chalk.green(`$${cost.toFixed(2)}`);
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

export function createSummaryTable(data: {
  today: number;
  week: number;
  month: number;
  allTime: number;
  sessions: number;
}): string {
  const table = new Table({
    head: [
      chalk.cyan('Today'),
      chalk.cyan('This Week'),
      chalk.cyan('This Month'),
      chalk.cyan('All Time'),
      chalk.cyan('Sessions'),
    ],
    style: { head: [], border: ['gray'] },
  });
  table.push([
    formatCost(data.today),
    formatCost(data.week),
    formatCost(data.month),
    formatCost(data.allTime),
    chalk.white(String(data.sessions)),
  ]);
  return table.toString();
}

export function createSessionsTable(sessions: {
  date: string;
  time: string;
  source: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  title?: string;
}[]): string {
  const table = new Table({
    head: [
      chalk.cyan('Date'),
      chalk.cyan('Time'),
      chalk.cyan('Source'),
      chalk.cyan('Model'),
      chalk.cyan('In'),
      chalk.cyan('Out'),
      chalk.cyan('Cost'),
      chalk.cyan('Title'),
    ],
    style: { head: [], border: ['gray'] },
    colWidths: [12, 7, 16, 22, 9, 9, 10, 40],
    wordWrap: true,
  });
  for (const s of sessions) {
    table.push([
      s.date,
      s.time,
      s.source,
      s.model.replace('claude-', ''),
      formatTokens(s.input_tokens),
      formatTokens(s.output_tokens),
      formatCost(s.cost),
      (s.title || '').substring(0, 37) + ((s.title || '').length > 37 ? '...' : ''),
    ]);
  }
  return table.toString();
}

export function createSourceTable(totals: Record<string, number>): string {
  const table = new Table({
    head: [chalk.cyan('Source'), chalk.cyan('Cost')],
    style: { head: [], border: ['gray'] },
  });
  const entries = Object.entries(totals)
    .filter(([k]) => k !== 'grand_total')
    .sort((a, b) => b[1] - a[1]);
  for (const [source, cost] of entries) {
    table.push([source, formatCost(cost)]);
  }
  return table.toString();
}

export function createProjectsTable(projects: { cwd: string; cost: number; sessions: number }[]): string {
  const table = new Table({
    head: [chalk.cyan('Project'), chalk.cyan('Sessions'), chalk.cyan('Cost')],
    style: { head: [], border: ['gray'] },
    colWidths: [60, 10, 12],
  });
  for (const p of projects.slice(0, 20)) {
    table.push([
      p.cwd || '(no project)',
      String(p.sessions),
      formatCost(p.cost),
    ]);
  }
  return table.toString();
}
