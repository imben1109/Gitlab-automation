'use strict';

const chalk = require('chalk');
const inquirer = require('inquirer');
const config = require('./config');

const MAX_DESCRIPTION_PREVIEW_LENGTH = 120;
const gitlab = require('./gitlab');
const copilot = require('./copilot');
const git = require('./git');

/**
 * Convert a string into a URL/branch-safe slug.
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Run the full GitLab automation workflow.
 * @param {number|string} issueNumber
 * @param {{ autoConfirm?: boolean, repoPath?: string }} options
 */
async function run(issueNumber, options = {}) {
  const repoPath = options.repoPath || config.TARGET_REPO_PATH;

  // Step 1: Fetch the issue
  console.log(chalk.blue(`\nFetching GitLab issue #${issueNumber}...`));
  const issue = await gitlab.getIssue(config.GITLAB_PROJECT_ID, issueNumber);
  console.log(chalk.green(`✔ Issue: ${issue.title}`));
  if (issue.description) {
    const firstLine = issue.description.split('\n')[0];
    const preview = firstLine.length > MAX_DESCRIPTION_PREVIEW_LENGTH
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
  } catch (err) {
    const msg = err.response && err.response.data && err.response.data.message;
    if (msg && (Array.isArray(msg) ? msg.join('') : msg).toLowerCase().includes('already exists')) {
      console.log(chalk.yellow(`⚠ Branch already exists, continuing...`));
    } else {
      throw err;
    }
  }

  // Step 4: Checkout branch locally if a repo path was explicitly provided
  if (repoPath !== process.cwd()) {
    console.log(chalk.blue(`Checking out branch locally in ${repoPath}...`));
    try {
      await git.checkoutNewBranch(repoPath, branchName);
      console.log(chalk.green(`✔ Checked out: ${branchName}`));
    } catch (err) {
      console.log(chalk.yellow(`⚠ Could not checkout branch locally: ${err.message}`));
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
  } catch (err) {
    console.log(chalk.yellow(`⚠ Copilot API unavailable: ${err.message}`));
    console.log(chalk.yellow('  Continuing workflow without a generated plan.\n'));
  }

  // Step 6: Confirm before committing
  let proceed = options.autoConfirm;
  if (!proceed) {
    const { confirm } = await inquirer.prompt([
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
  } catch (err) {
    console.log(chalk.yellow(`⚠ Git operation failed: ${err.message}`));
    console.log(chalk.yellow('  Continuing to create MR anyway...'));
  }

  // Step 8: Create Merge Request
  console.log(chalk.blue('Creating GitLab Merge Request...'));
  const mrDescription =
    (plan ? `## Copilot Implementation Plan\n\n${plan}\n\n---\n\n` : '') +
    `Related issue: ${issue.webUrl}`;

  const mr = await gitlab.createMergeRequest(config.GITLAB_PROJECT_ID, {
    title: `Issue #${issue.iid}: ${issue.title}`,
    description: mrDescription,
    sourceBranch: branchName,
    targetBranch: 'main',
  });

  console.log(chalk.green(`\n✔ Merge Request created: ${chalk.bold(mr.webUrl)}`));
}

module.exports = { run, slugify };
