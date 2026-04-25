'use strict';

import chalk from 'chalk';
import inquirer from 'inquirer';
import config = require('./config');
import * as gitlab from './gitlab';
import * as copilot from './copilot';
import * as git from './git';

const MAX_DESCRIPTION_PREVIEW_LENGTH = 120;

/**
 * Convert a string into a URL / branch-safe slug.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

export interface RunOptions {
  autoConfirm?: boolean;
  /** Absolute path to a local git repo to checkout/commit in. */
  repoPath?: string;
}

/**
 * Run the full GitLab automation workflow.
 */
export async function run(
  issueNumber: number | string,
  options: RunOptions = {}
): Promise<void> {
  // Only perform a local git checkout when an explicit path was provided.
  // Comparing against process.cwd() is unreliable (relative vs absolute,
  // symlinks, etc.) — instead we track whether the caller passed a value.
  const hasExplicitRepoPath = !!(options.repoPath || process.env.TARGET_REPO_PATH);
  const repoPath = options.repoPath || config.TARGET_REPO_PATH;

  // Step 1: Fetch the issue
  console.log(chalk.blue(`\nFetching GitLab issue #${issueNumber}...`));
  const issue = await gitlab.getIssue(config.GITLAB_PROJECT_ID, Number(issueNumber));
  console.log(chalk.green(`✔ Issue: ${issue.title}`));
  if (issue.description) {
    const firstLine = issue.description.split('\n')[0];
    const preview =
      firstLine.length > MAX_DESCRIPTION_PREVIEW_LENGTH
        ? firstLine.substring(0, MAX_DESCRIPTION_PREVIEW_LENGTH) + '...'
        : firstLine;
    console.log(chalk.gray(`  ${preview}`));
  }

  // Step 2: Build branch name
  const branchName = `issue-${issue.iid}-${slugify(issue.title)}`;
  console.log(chalk.blue(`\nBranch name: ${chalk.bold(branchName)}`));

  // Step 3: Create branch via GitLab API
  console.log(chalk.blue('Creating branch on GitLab...'));
  try {
    await gitlab.createBranch(config.GITLAB_PROJECT_ID, branchName);
    console.log(chalk.green(`✔ Branch created: ${branchName}`));
  } catch (err: unknown) {
    const msg =
      err &&
      typeof err === 'object' &&
      'response' in err &&
      (err as { response?: { data?: { message?: unknown } } }).response?.data?.message;

    // Normalise to a plain string: join arrays, stringify objects.
    const msgStr = Array.isArray(msg)
      ? msg.join(' ')
      : msg && typeof msg === 'object'
        ? JSON.stringify(msg)
        : typeof msg === 'string'
          ? msg
          : '';

    if (msgStr.toLowerCase().includes('already exists')) {
      console.log(chalk.yellow('⚠ Branch already exists, continuing...'));
    } else {
      throw err;
    }
  }

  // Step 4: Checkout branch locally only if a repo path was explicitly provided
  if (hasExplicitRepoPath) {
    console.log(chalk.blue(`Checking out branch locally in ${repoPath}...`));
    try {
      await git.checkoutNewBranch(repoPath, branchName);
      console.log(chalk.green(`✔ Checked out: ${branchName}`));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`⚠ Could not checkout branch locally: ${message}`));
    }
  }

  // Step 5: Generate Copilot plan
  console.log(chalk.blue('\nAsking GitHub Copilot to generate an implementation plan...'));
  let plan = '';
  try {
    plan = await copilot.generatePlan(issue.title, issue.description);
    console.log(chalk.cyan('\n─── Copilot Implementation Plan ───────────────────────────'));
    console.log(plan);
    console.log(chalk.cyan('────────────────────────────────────────────────────────────\n'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`⚠ Copilot API unavailable: ${message}`));
    console.log(chalk.yellow('  Continuing workflow without a generated plan.\n'));
  }

  // Step 6: Confirm before committing
  let proceed = options.autoConfirm;
  if (!proceed) {
    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Do you want to proceed with committing and pushing changes?',
        default: false,
      },
    ]);
    proceed = confirm;
  }

  if (!proceed) {
    console.log(chalk.yellow('Skipping commit/push. Exiting.'));
    return;
  }

  // Step 7: Commit and push
  console.log(chalk.blue('Committing and pushing changes...'));
  const commitMessage = `feat: implement issue #${issue.iid} - ${issue.title}`;
  try {
    await git.commitAndPush(repoPath, branchName, commitMessage);
    console.log(chalk.green('✔ Changes committed and pushed.'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(chalk.yellow(`⚠ Git operation failed: ${message}`));
    console.log(chalk.yellow('  Continuing to create MR anyway...'));
  }

  // Step 8: Create Merge Request
  console.log(chalk.blue('Creating GitLab Merge Request...'));
  const mrDescription =
    (plan ? `## Copilot Implementation Plan\n\n${plan}\n\n---\n\n` : '') +
    `Related issue: ${issue.webUrl}`;

  const mr = await gitlab.createMergeRequest(config.GITLAB_PROJECT_ID, {
    title:        `Issue #${issue.iid}: ${issue.title}`,
    description:  mrDescription,
    sourceBranch: branchName,
    targetBranch: 'main',
  });

  console.log(chalk.green(`\n✔ Merge Request created: ${chalk.bold(mr.webUrl)}`));
}
