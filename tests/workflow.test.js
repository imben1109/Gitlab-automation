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

// ── shared mocks ──────────────────────────────────────────────────────────────

jest.mock('../src/config', () => ({
  GITLAB_URL: 'https://gitlab.com',
  GITLAB_TOKEN: 'gl-token',
  GITLAB_PROJECT_ID: 'mygroup/myproject',
  TARGET_REPO_PATH: '/default/path',
}));

jest.mock('../src/gitlab');
jest.mock('../src/git');
jest.mock('fs');
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
const git    = require('../src/git');
const fs     = require('fs');
const { start, finish } = require('../src/workflow');

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
  git.ensureMainBranch.mockResolvedValue(undefined);
  git.checkoutNewBranch.mockResolvedValue(undefined);
  git.commitAndPush.mockResolvedValue(undefined);
  fs.writeFileSync = jest.fn();
});

// ── workflow.start ────────────────────────────────────────────────────────────

describe('workflow.start — happy path', () => {
  test('fetches the issue using config project ID', async () => {
    await start(42, { repoPath: '/my/repo' });

    expect(gitlab.getIssue).toHaveBeenCalledWith('mygroup/myproject', 42);
  });

  test('builds correct branch name from issue iid and title', async () => {
    await start(42, { repoPath: '/my/repo' });

    expect(gitlab.createBranch).toHaveBeenCalledWith(
      'mygroup/myproject',
      'issue-42-fix-the-navbar'
    );
  });

  test('verifies main branch when repoPath is provided', async () => {
    await start(42, { repoPath: '/my/repo' });

    expect(git.ensureMainBranch).toHaveBeenCalledWith('/my/repo');
  });

  test('does not verify main branch when no repoPath is set', async () => {
    delete process.env.TARGET_REPO_PATH;
    await start(42);

    expect(git.ensureMainBranch).not.toHaveBeenCalled();
  });

  test('checks out branch locally when repoPath is provided', async () => {
    await start(42, { repoPath: '/my/repo' });

    expect(git.checkoutNewBranch).toHaveBeenCalledWith('/my/repo', 'issue-42-fix-the-navbar');
  });

  test('writes issue markdown file', async () => {
    await start(42, { repoPath: '/my/repo' });

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('issue-42.md'),
      expect.stringContaining('Fix the navbar'),
      'utf-8'
    );
  });

  test('markdown file contains issue URL', async () => {
    await start(42, { repoPath: '/my/repo' });

    const [, content] = fs.writeFileSync.mock.calls[0];
    expect(content).toContain(MOCK_ISSUE.webUrl);
  });

  test('markdown file contains branch name', async () => {
    await start(42, { repoPath: '/my/repo' });

    const [, content] = fs.writeFileSync.mock.calls[0];
    expect(content).toContain('issue-42-fix-the-navbar');
  });
});

describe('workflow.start — branch already exists', () => {
  test('continues when GitLab reports branch already exists (string message)', async () => {
    const err = new Error('branch already exists');
    err.response = { data: { message: 'Branch already exists' } };
    gitlab.createBranch.mockRejectedValue(err);

    await expect(start(42, { repoPath: '/my/repo' })).resolves.not.toThrow();
  });

  test('continues when GitLab returns message as array', async () => {
    const err = new Error('validation failed');
    err.response = { data: { message: ['Branch already exists'] } };
    gitlab.createBranch.mockRejectedValue(err);

    await expect(start(42, { repoPath: '/my/repo' })).resolves.not.toThrow();
  });

  test('rethrows errors unrelated to branch existence', async () => {
    const err = new Error('unauthorized');
    err.response = { data: { message: 'Unauthorized' } };
    gitlab.createBranch.mockRejectedValue(err);

    await expect(start(42, { repoPath: '/my/repo' })).rejects.toThrow('unauthorized');
  });
});

// ── workflow.finish ───────────────────────────────────────────────────────────

describe('workflow.finish — happy path', () => {
  test('fetches the issue to get title and URL', async () => {
    await finish(42, { repoPath: '/my/repo' });

    expect(gitlab.getIssue).toHaveBeenCalledWith('mygroup/myproject', 42);
  });

  test('commits and pushes with conventional message', async () => {
    await finish(42, { repoPath: '/my/repo' });

    expect(git.commitAndPush).toHaveBeenCalledWith(
      '/my/repo',
      'issue-42-fix-the-navbar',
      'feat: issue #42 - Fix the navbar'
    );
  });

  test('creates MR with correct branch name and title', async () => {
    await finish(42, { repoPath: '/my/repo' });

    expect(gitlab.createMergeRequest).toHaveBeenCalledWith(
      'mygroup/myproject',
      expect.objectContaining({
        sourceBranch: 'issue-42-fix-the-navbar',
        targetBranch: 'main',
        title: 'Issue #42: Fix the navbar',
      })
    );
  });

  test('MR description contains issue URL', async () => {
    await finish(42, { repoPath: '/my/repo' });

    const { description } = gitlab.createMergeRequest.mock.calls[0][1];
    expect(description).toContain(MOCK_ISSUE.webUrl);
  });

  test('MR description does not contain Copilot plan section', async () => {
    await finish(42, { repoPath: '/my/repo' });

    const { description } = gitlab.createMergeRequest.mock.calls[0][1];
    expect(description).not.toContain('Copilot');
  });
});

describe('workflow.finish — commit errors propagate', () => {
  test('throws when commitAndPush fails', async () => {
    git.commitAndPush.mockRejectedValue(new Error('nothing to commit'));

    await expect(finish(42, { repoPath: '/my/repo' })).rejects.toThrow('nothing to commit');
  });
});
