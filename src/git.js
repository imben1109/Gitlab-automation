'use strict';

const simpleGit = require('simple-git');

/**
 * Checkout a new branch in the given repo.
 * @param {string} repoPath - local path to the git repository
 * @param {string} branchName
 */
async function checkoutNewBranch(repoPath, branchName) {
  const git = simpleGit(repoPath);
  await git.checkoutLocalBranch(branchName);
}

/**
 * Stage all changes, commit, and push the branch.
 * @param {string} repoPath - local path to the git repository
 * @param {string} branchName
 * @param {string} message - commit message
 */
async function commitAndPush(repoPath, branchName, message) {
  const git = simpleGit(repoPath);
  await git.add('.');
  await git.commit(message);
  await git.push('origin', branchName, ['--set-upstream']);
}

module.exports = { checkoutNewBranch, commitAndPush };
