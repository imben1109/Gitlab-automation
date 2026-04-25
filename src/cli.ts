#!/usr/bin/env node
'use strict';

import chalk from 'chalk';
import { start, finish } from './workflow';

function printUsage(): void {
  console.log('Usage:');
  console.log('  gitlab-automation start  <issue-number> [--repo-path=<path>]');
  console.log('  gitlab-automation finish <issue-number> [--repo-path=<path>]');
  console.log('');
  console.log('Commands:');
  console.log('  start   Fetch the issue, verify main branch, create feature branch,');
  console.log('          and export the issue to a Markdown file for planning.');
  console.log('  finish  Commit your changes and open a Merge Request on GitLab.');
  console.log('');
  console.log('Options:');
  console.log('  --repo-path=<path>  Path to local git repo (overrides TARGET_REPO_PATH)');
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  printUsage();
  process.exit(0);
}

const command = args[0];
if (command !== 'start' && command !== 'finish') {
  console.error(chalk.red(`Error: unknown command '${command}'. Expected 'start' or 'finish'.`));
  printUsage();
  process.exit(1);
}

const issueArg = args[1];
if (!issueArg) {
  console.error(chalk.red(`Error: <issue-number> is required.`));
  printUsage();
  process.exit(1);
}

const issueNumber = parseInt(issueArg, 10);
if (isNaN(issueNumber) || issueNumber <= 0) {
  console.error(chalk.red(`Error: issue-number must be a positive integer, got: ${issueArg}`));
  printUsage();
  process.exit(1);
}

let repoPath: string | undefined;
for (const arg of args.slice(2)) {
  const match = arg.match(/^--repo-path=(.+)$/);
  if (match) {
    repoPath = match[1];
  }
}

const handler = command === 'start'
  ? start(issueNumber, { repoPath })
  : finish(issueNumber, { repoPath });

handler.catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const axiosErr = err as { response?: { status?: number; data?: unknown } };
  console.error(chalk.red(`\nError: ${message}`));
  if (axiosErr.response) {
    console.error(
      chalk.red(`  HTTP ${axiosErr.response.status}: ${JSON.stringify(axiosErr.response.data)}`)
    );
  }
  process.exit(1);
});
