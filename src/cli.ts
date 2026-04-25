#!/usr/bin/env node
'use strict';

import chalk from 'chalk';
import { run } from './workflow';

function printUsage(): void {
  console.log('Usage: gitlab-automation <issue-number> [--auto-confirm] [--repo-path=<path>]');
  console.log('');
  console.log('Options:');
  console.log('  --auto-confirm      Skip the confirmation prompt');
  console.log('  --repo-path=<path>  Path to local git repo (overrides TARGET_REPO_PATH)');
}

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  printUsage();
  process.exit(0);
}

const issueNumber = parseInt(args[0], 10);
if (isNaN(issueNumber) || issueNumber <= 0) {
  console.error(chalk.red(`Error: issue-number must be a positive integer, got: ${args[0]}`));
  printUsage();
  process.exit(1);
}

const autoConfirm = args.includes('--auto-confirm');
let repoPath: string | undefined;
for (const arg of args) {
  const match = arg.match(/^--repo-path=(.+)$/);
  if (match) {
    repoPath = match[1];
  }
}

run(issueNumber, { autoConfirm, repoPath }).catch((err: unknown) => {
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
