'use strict';

import simpleGit from 'simple-git';

/**
 * Checkout a new branch in the given local repository.
 * @param repoPath - absolute path to the git repository
 * @param branchName - name of the new branch
 */
export async function checkoutNewBranch(
  repoPath: string,
  branchName: string
): Promise<void> {
  const git = simpleGit(repoPath);
  await git.checkoutLocalBranch(branchName);
}

/**
 * Stage all changes, commit, and push the branch.
 * @param repoPath  - absolute path to the git repository
 * @param branchName - branch to push
 * @param message   - commit message
 */
export async function commitAndPush(
  repoPath: string,
  branchName: string,
  message: string
): Promise<void> {
  const git = simpleGit(repoPath);
  await git.add('.');
  await git.commit(message);
  await git.push('origin', branchName, ['--set-upstream']);
}
