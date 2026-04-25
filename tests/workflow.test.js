'use strict';

const { slugify } = require('../src/workflow');

describe('workflow.slugify', () => {
  test('lowercases text', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  test('replaces spaces with hyphens', () => {
    expect(slugify('fix the login bug')).toBe('fix-the-login-bug');
  });

  test('removes special characters', () => {
    expect(slugify('Fix: login bug (urgent!)')).toBe('fix-login-bug-urgent');
  });

  test('collapses multiple spaces and hyphens', () => {
    expect(slugify('fix  -  the  bug')).toBe('fix-the-bug');
  });

  test('trims leading and trailing hyphens', () => {
    expect(slugify('  - fix bug - ')).toBe('fix-bug');
  });

  test('handles an already-slug string', () => {
    expect(slugify('add-dark-mode')).toBe('add-dark-mode');
  });

  test('handles numeric characters', () => {
    expect(slugify('Issue 42 Fix')).toBe('issue-42-fix');
  });

  test('returns empty string for all-special input', () => {
    expect(slugify('!!!@@@###')).toBe('');
  });
});

// ── workflow.run ─────────────────────────────────────────────────────────────

jest.mock('../src/config', () => ({
  GITLAB_URL: 'https://gitlab.com',
  GITLAB_TOKEN: 'gl-token',
  GITLAB_PROJECT_ID: 'mygroup/myproject',
  GITHUB_TOKEN: 'gh-token',
  TARGET_REPO_PATH: '/default/path',
}));

jest.mock('../src/gitlab');
jest.mock('../src/copilot');
jest.mock('../src/git');
jest.mock('inquirer');
// Suppress chalk coloring in test output.
jest.mock('chalk', () => {
  const noop = (s) => s;
  const chalk = new Proxy(noop, {
    get: () => new Proxy(noop, { get: () => noop }),
  });
  chalk.bold = noop;
  return chalk;
});

const gitlab = require('../src/gitlab');
const copilot = require('../src/copilot');
const git = require('../src/git');
const inquirer = require('inquirer');
const { run } = require('../src/workflow');

const MOCK_ISSUE = {
  id: 1,
  iid: 42,
  title: 'Fix the navbar',
  description: 'The navbar breaks on mobile.',
  webUrl: 'https://gitlab.com/mygroup/myproject/-/issues/42',
};

const MOCK_MR = {
  iid: 1,
  webUrl: 'https://gitlab.com/mygroup/myproject/-/merge_requests/1',
};

beforeEach(() => {
  jest.clearAllMocks();
  gitlab.getIssue.mockResolvedValue(MOCK_ISSUE);
  gitlab.createBranch.mockResolvedValue({});
  gitlab.createMergeRequest.mockResolvedValue(MOCK_MR);
  copilot.generatePlan.mockResolvedValue('1. Plan step one\n2. Plan step two');
  git.checkoutNewBranch.mockResolvedValue(undefined);
  git.commitAndPush.mockResolvedValue(undefined);
  inquirer.prompt = jest.fn().mockResolvedValue({ confirm: true });
});

describe('workflow.run — happy path', () => {
  test('fetches the issue using config project ID', async () => {
    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    expect(gitlab.getIssue).toHaveBeenCalledWith('mygroup/myproject', 42);
  });

  test('builds correct branch name from issue iid and title', async () => {
    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    expect(gitlab.createBranch).toHaveBeenCalledWith(
      'mygroup/myproject',
      'issue-42-fix-the-navbar'
    );
  });

  test('calls generatePlan with issue title and description', async () => {
    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    expect(copilot.generatePlan).toHaveBeenCalledWith(
      'Fix the navbar',
      'The navbar breaks on mobile.'
    );
  });

  test('creates MR with branch name and copilot plan', async () => {
    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    expect(gitlab.createMergeRequest).toHaveBeenCalledWith(
      'mygroup/myproject',
      expect.objectContaining({
        sourceBranch: 'issue-42-fix-the-navbar',
        targetBranch: 'main',
        title: 'Issue #42: Fix the navbar',
      })
    );
  });

  test('MR description includes Copilot plan and issue URL', async () => {
    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    const { description } = gitlab.createMergeRequest.mock.calls[0][1];
    expect(description).toContain('1. Plan step one');
    expect(description).toContain(MOCK_ISSUE.webUrl);
  });

  test('checks out branch locally when repoPath is provided', async () => {
    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    expect(git.checkoutNewBranch).toHaveBeenCalledWith(
      '/my/repo',
      'issue-42-fix-the-navbar'
    );
  });

  test('commits and pushes when autoConfirm is true', async () => {
    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    expect(git.commitAndPush).toHaveBeenCalledWith(
      '/my/repo',
      'issue-42-fix-the-navbar',
      'feat: implement issue #42 - Fix the navbar'
    );
  });
});

describe('workflow.run — confirmation prompt', () => {
  test('prompts user when autoConfirm is false', async () => {
    inquirer.prompt.mockResolvedValue({ confirm: true });

    await run(42, { autoConfirm: false, repoPath: '/my/repo' });

    expect(inquirer.prompt).toHaveBeenCalled();
    expect(git.commitAndPush).toHaveBeenCalled();
  });

  test('skips commit/push when user declines', async () => {
    inquirer.prompt.mockResolvedValue({ confirm: false });

    await run(42, { autoConfirm: false, repoPath: '/my/repo' });

    expect(git.commitAndPush).not.toHaveBeenCalled();
    expect(gitlab.createMergeRequest).not.toHaveBeenCalled();
  });
});

describe('workflow.run — Copilot failure graceful degradation', () => {
  test('continues when Copilot API throws', async () => {
    copilot.generatePlan.mockRejectedValue(new Error('API unavailable'));

    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    // MR should still be created
    expect(gitlab.createMergeRequest).toHaveBeenCalled();
  });

  test('MR description still contains issue URL when plan is unavailable', async () => {
    copilot.generatePlan.mockRejectedValue(new Error('API unavailable'));

    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    const { description } = gitlab.createMergeRequest.mock.calls[0][1];
    expect(description).toContain(MOCK_ISSUE.webUrl);
    expect(description).not.toContain('Copilot Implementation Plan');
  });
});

describe('workflow.run — branch already exists', () => {
  test('continues when GitLab reports branch already exists (string message)', async () => {
    const err = new Error('branch already exists');
    err.response = { data: { message: 'Branch already exists' } };
    gitlab.createBranch.mockRejectedValue(err);

    await expect(run(42, { autoConfirm: true, repoPath: '/my/repo' })).resolves.not.toThrow();
    expect(gitlab.createMergeRequest).toHaveBeenCalled();
  });

  test('continues when GitLab returns message as array', async () => {
    const err = new Error('validation failed');
    err.response = { data: { message: ['Branch already exists'] } };
    gitlab.createBranch.mockRejectedValue(err);

    await expect(run(42, { autoConfirm: true, repoPath: '/my/repo' })).resolves.not.toThrow();
  });

  test('rethrows errors unrelated to branch existence', async () => {
    const err = new Error('unauthorized');
    err.response = { data: { message: 'Unauthorized' } };
    gitlab.createBranch.mockRejectedValue(err);

    await expect(run(42, { autoConfirm: true, repoPath: '/my/repo' })).rejects.toThrow(
      'unauthorized'
    );
  });
});

describe('workflow.run — git failure graceful degradation', () => {
  test('continues to create MR even when commitAndPush fails', async () => {
    git.commitAndPush.mockRejectedValue(new Error('nothing to commit'));

    await run(42, { autoConfirm: true, repoPath: '/my/repo' });

    expect(gitlab.createMergeRequest).toHaveBeenCalled();
  });
});

describe('workflow.run — description preview truncation', () => {
  test('does not crash with long multi-line description', async () => {
    const longDesc = 'A'.repeat(200) + '\nSecond line';
    gitlab.getIssue.mockResolvedValue({ ...MOCK_ISSUE, description: longDesc });

    await expect(run(42, { autoConfirm: true, repoPath: '/my/repo' })).resolves.not.toThrow();
  });

  test('does not crash with no description', async () => {
    gitlab.getIssue.mockResolvedValue({ ...MOCK_ISSUE, description: '' });

    await expect(run(42, { autoConfirm: true, repoPath: '/my/repo' })).resolves.not.toThrow();
  });
});
