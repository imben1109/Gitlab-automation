'use strict';

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import config = require('./config');
import * as gitlab from './gitlab';
import * as git from './git';

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

export interface StartOptions {
  /** Absolute path to a local git repo to checkout and write the issue file in. */
  repoPath?: string;
}

export interface FinishOptions {
  /** Absolute path to a local git repo to commit/push from. */
  repoPath?: string;
}

/**
 * Step 1 — Start the workflow for a GitLab issue.
 *
 * 1. Fetch the issue from GitLab.
 * 2. Detect whether repoPath (defaults to cwd) is a valid git repository.
 * 3. If inside a git repo: verify the current branch is `main` and up-to-date.
 * 4. Create the feature branch via the GitLab API.
 * 5. If inside a git repo: checkout the branch locally.
 * 6. Export the issue to `issue-<iid>.md` for manual planning and tracking.
 */
export async function start(
  issueNumber: number | string,
  options: StartOptions = {}
): Promise<void> {
  const repoPath = options.repoPath || config.TARGET_REPO_PATH;
  const hasCustomPath = !!(options.repoPath || process.env.TARGET_REPO_PATH);

  // 1. Fetch the issue
  console.log(chalk.blue(`\nFetching GitLab issue #${issueNumber}...`));
  const issue = await gitlab.getIssue(config.GITLAB_PROJECT_ID, Number(issueNumber));
  console.log(chalk.green(`✔ Issue: ${issue.title}`));

  // 2. Build branch name
  const branchName = `issue-${issue.iid}-${slugify(issue.title)}`;
  console.log(chalk.blue(`\nBranch name: ${chalk.bold(branchName)}`));

  // 3. Detect whether repoPath is a valid git repository
  const isGitRepo = await git.isGitRepository(repoPath);

  // 4. Check that the local repo is on main and up-to-date (only when inside a git repo)
  if (isGitRepo) {
    console.log(chalk.blue('Verifying local branch state...'));
    try {
      await git.ensureMainBranch(repoPath);
      console.log(chalk.green('✔ On main and up-to-date with origin.'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`✘ ${message}`));
      process.exit(1);
    }
  }

  // 5. Create branch via GitLab API
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

  // 5. Checkout branch locally (only when inside a valid git repository)
  if (isGitRepo) {
    console.log(chalk.blue(`Checking out branch locally in ${repoPath}...`));
    try {
      await git.checkoutNewBranch(repoPath, branchName);
      console.log(chalk.green(`✔ Checked out: ${branchName}`));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(chalk.yellow(`⚠ Could not checkout branch locally: ${message}`));
    }
  }

  // 7. Write the issue markdown file
  const markdownPath = path.join(repoPath, `issue-${issue.iid}.md`);
  const markdownContent = buildIssueMarkdown(issue, branchName);
  fs.writeFileSync(markdownPath, markdownContent, 'utf-8');
  console.log(chalk.green(`✔ Issue exported to ${markdownPath}`));

  console.log(chalk.cyan('\nNext steps:'));
  console.log(chalk.cyan(`  1. Review and update ${path.basename(markdownPath)}`));
  console.log(chalk.cyan('  2. Make your changes in the codebase'));
  console.log(
    chalk.cyan(`  3. Run: gitlab-automation finish ${issue.iid}${hasCustomPath ? ` --repo-path=${repoPath}` : ''}`)
  );
}

/**
 * Step 2 — Finish the workflow: commit changes and open a Merge Request.
 *
 * 1. Fetch the issue to obtain the title and URL.
 * 2. Commit and push all staged changes with a conventional commit message.
 * 3. Create a GitLab Merge Request whose description links back to the issue.
 */
export async function finish(
  issueNumber: number | string,
  options: FinishOptions = {}
): Promise<void> {
  const repoPath = options.repoPath || config.TARGET_REPO_PATH;

  // 1. Fetch the issue
  console.log(chalk.blue(`\nFetching GitLab issue #${issueNumber}...`));
  const issue = await gitlab.getIssue(config.GITLAB_PROJECT_ID, Number(issueNumber));
  console.log(chalk.green(`✔ Issue: ${issue.title}`));

  const branchName = `issue-${issue.iid}-${slugify(issue.title)}`;

  // 2. Commit and push
  console.log(chalk.blue('Committing and pushing changes...'));
  const commitMessage = `feat: issue #${issue.iid} - ${issue.title}`;
  await git.commitAndPush(repoPath, branchName, commitMessage);
  console.log(chalk.green('✔ Changes committed and pushed.'));

  // 3. Create Merge Request
  console.log(chalk.blue('Creating GitLab Merge Request...'));
  const mr = await gitlab.createMergeRequest(config.GITLAB_PROJECT_ID, {
    title:        `Issue #${issue.iid}: ${issue.title}`,
    description:  `Related issue: ${issue.webUrl}`,
    sourceBranch: branchName,
    targetBranch: 'main',
  });

  console.log(chalk.green(`\n✔ Merge Request created: ${chalk.bold(mr.webUrl)}`));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function buildIssueMarkdown(
  issue: gitlab.GitLabIssue,
  branchName: string
): string {
  return [
    `# Issue #${issue.iid}: ${issue.title}`,
    '',
    `**URL:** ${issue.webUrl}`,
    `**Branch:** ${branchName}`,
    '',
    '## Description',
    '',
    issue.description ? issue.description : '_No description provided._',
    '',
    '## Planning',
    '',
    '<!-- Add your implementation plan here -->',
    '',
    '## Progress',
    '',
    '- [ ] Add your first task here',
    '',
  ].join('\n');
}
