'use strict';

jest.mock('simple-git');

const simpleGit = require('simple-git');
const { checkoutNewBranch, commitAndPush, ensureMainBranch, isGitRepository } = require('../src/git');

function makeMockGit(overrides = {}) {
  return {
    checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue({ summary: { changes: 1 } }),
    push: jest.fn().mockResolvedValue(undefined),
    status: jest.fn().mockResolvedValue({ current: 'main' }),
    fetch: jest.fn().mockResolvedValue(undefined),
    log: jest.fn().mockResolvedValue({ total: 0, all: [] }),
    revparse: jest.fn().mockResolvedValue('.git'),
    ...overrides,
  };
}

describe('git.checkoutNewBranch', () => {
  test('calls checkoutLocalBranch with the given branch name', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await checkoutNewBranch('/tmp/repo', 'issue-5-fix-bug');

    expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('issue-5-fix-bug');
  });

  test('initialises simple-git with the repo path', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await checkoutNewBranch('/my/custom/path', 'my-branch');

    expect(simpleGit).toHaveBeenCalledWith('/my/custom/path');
  });

  test('propagates errors from simple-git', async () => {
    const mockGit = makeMockGit({
      checkoutLocalBranch: jest.fn().mockRejectedValue(new Error('already exists')),
    });
    simpleGit.mockReturnValue(mockGit);

    await expect(checkoutNewBranch('/tmp/repo', 'existing-branch')).rejects.toThrow(
      'already exists'
    );
  });
});

describe('git.commitAndPush', () => {
  test('stages all files', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await commitAndPush('/tmp/repo', 'my-branch', 'feat: add feature');

    expect(mockGit.add).toHaveBeenCalledWith('.');
  });

  test('commits with the provided message', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await commitAndPush('/tmp/repo', 'my-branch', 'feat: add feature');

    expect(mockGit.commit).toHaveBeenCalledWith('feat: add feature');
  });

  test('pushes the branch to origin with --set-upstream', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await commitAndPush('/tmp/repo', 'my-branch', 'feat: add feature');

    expect(mockGit.push).toHaveBeenCalledWith('origin', 'my-branch', ['--set-upstream']);
  });

  test('propagates commit errors', async () => {
    const mockGit = makeMockGit({
      commit: jest.fn().mockRejectedValue(new Error('nothing to commit')),
    });
    simpleGit.mockReturnValue(mockGit);

    await expect(commitAndPush('/tmp/repo', 'branch', 'msg')).rejects.toThrow(
      'nothing to commit'
    );
  });

  test('propagates push errors', async () => {
    const mockGit = makeMockGit({
      push: jest.fn().mockRejectedValue(new Error('remote rejected')),
    });
    simpleGit.mockReturnValue(mockGit);

    await expect(commitAndPush('/tmp/repo', 'branch', 'msg')).rejects.toThrow(
      'remote rejected'
    );
  });
});

describe('git.ensureMainBranch', () => {
  test('resolves when on main and up-to-date', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await expect(ensureMainBranch('/tmp/repo')).resolves.toBeUndefined();
    expect(mockGit.fetch).toHaveBeenCalledWith('origin', 'main');
  });

  test('throws when not on main branch', async () => {
    const mockGit = makeMockGit({
      status: jest.fn().mockResolvedValue({ current: 'feature-branch' }),
    });
    simpleGit.mockReturnValue(mockGit);

    await expect(ensureMainBranch('/tmp/repo')).rejects.toThrow(
      "Expected to be on 'main' branch, but currently on 'feature-branch'"
    );
  });

  test('throws when local main is behind origin/main', async () => {
    const mockGit = makeMockGit({
      log: jest.fn()
        .mockResolvedValueOnce({ total: 0 })   // origin/main..HEAD = 0 (not ahead)
        .mockResolvedValueOnce({ total: 3 }),   // HEAD..origin/main = 3 (behind)
    });
    simpleGit.mockReturnValue(mockGit);

    await expect(ensureMainBranch('/tmp/repo')).rejects.toThrow(
      '3 commit(s) behind origin/main'
    );
  });

  test('throws when local main is ahead of origin/main', async () => {
    const mockGit = makeMockGit({
      log: jest.fn().mockResolvedValueOnce({ total: 2 }),  // ahead by 2
    });
    simpleGit.mockReturnValue(mockGit);

    await expect(ensureMainBranch('/tmp/repo')).rejects.toThrow(
      '2 commit(s) ahead of origin/main'
    );
  });
});

describe('git.isGitRepository', () => {
  test('returns true when the path is inside a git repository', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await expect(isGitRepository('/tmp/repo')).resolves.toBe(true);
    expect(mockGit.revparse).toHaveBeenCalledWith(['--git-dir']);
  });

  test('returns false when the path is not a git repository', async () => {
    const mockGit = makeMockGit({
      revparse: jest.fn().mockRejectedValue(new Error('not a git repository')),
    });
    simpleGit.mockReturnValue(mockGit);

    await expect(isGitRepository('/tmp/not-a-repo')).resolves.toBe(false);
  });

  test('initialises simple-git with the given path', async () => {
    const mockGit = makeMockGit();
    simpleGit.mockReturnValue(mockGit);

    await isGitRepository('/my/custom/path');

    expect(simpleGit).toHaveBeenCalledWith('/my/custom/path');
  });
});
