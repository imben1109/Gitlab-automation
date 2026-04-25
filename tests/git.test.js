'use strict';

jest.mock('simple-git');

const simpleGit = require('simple-git');
const { checkoutNewBranch, commitAndPush } = require('../src/git');

function makeMockGit(overrides = {}) {
  return {
    checkoutLocalBranch: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue({ summary: { changes: 1 } }),
    push: jest.fn().mockResolvedValue(undefined),
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
