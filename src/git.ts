'use strict';

import simpleGit from 'simple-git';

/**
 * Return true if the given path is inside a valid git repository.
 * @param repoPath - absolute path to check
 */
export async function isGitRepository(repoPath: string): Promise<boolean> {
  try {
    const git = simpleGit(repoPath);
    await git.revparse(['--git-dir']);
    return true;
  } catch {
    return false;
  }
}

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
 * Verify the local repo is on `main` and up-to-date with origin/main.
 * Fetches from origin before comparing, then throws if the branch is
 * not `main`, is ahead, or is behind.
 *
 * @param repoPath - absolute path to the git repository
 */
export async function ensureMainBranch(repoPath: string): Promise<void> {
  const git = simpleGit(repoPath);

  const status = await git.status();
  if (status.current !== 'main') {
    throw new Error(
      `Expected to be on 'main' branch, but currently on '${status.current}'. ` +
      `Please switch to main before starting.`
    );
  }

  await git.fetch('origin', 'main');

  const aheadLog = await git.log(['origin/main..HEAD']);
  if (aheadLog.total > 0) {
    throw new Error(
      `Local main is ${aheadLog.total} commit(s) ahead of origin/main. ` +
      `Push or reset before starting.`
    );
  }

  const behindLog = await git.log(['HEAD..origin/main']);
  if (behindLog.total > 0) {
    throw new Error(
      `Local main is ${behindLog.total} commit(s) behind origin/main. ` +
      `Please run 'git pull' before starting.`
    );
  }
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
