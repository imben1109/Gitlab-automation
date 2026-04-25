'use strict';

// Provide a mock config so gitlab.js loads without real env vars.
jest.mock('../src/config', () => ({
  GITLAB_URL: 'https://gitlab.com',
  GITLAB_TOKEN: 'test-gl-token',
  GITLAB_PROJECT_ID: 'test-group/test-project',
  GITHUB_TOKEN: 'test-gh-token',
  TARGET_REPO_PATH: '/tmp/repo',
}));

jest.mock('axios');

const axios = require('axios');
const { getIssue, createBranch, createMergeRequest } = require('../src/gitlab');

const MOCK_ISSUE_DATA = {
  id: 100,
  iid: 5,
  title: 'Fix the login bug',
  description: 'Users cannot log in using SSO.',
  web_url: 'https://gitlab.com/test-group/test-project/-/issues/5',
};

describe('gitlab.getIssue', () => {
  test('returns mapped issue fields', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: MOCK_ISSUE_DATA });

    const issue = await getIssue('test-group/test-project', 5);

    expect(issue).toEqual({
      id: 100,
      iid: 5,
      title: 'Fix the login bug',
      description: 'Users cannot log in using SSO.',
      webUrl: 'https://gitlab.com/test-group/test-project/-/issues/5',
    });
  });

  test('encodes the project ID in the URL', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: MOCK_ISSUE_DATA });

    await getIssue('my group/my project', 5);

    const calledUrl = axios.get.mock.calls[0][0];
    expect(calledUrl).toContain('my%20group%2Fmy%20project');
  });

  test('uses PRIVATE-TOKEN header', async () => {
    axios.get = jest.fn().mockResolvedValue({ data: MOCK_ISSUE_DATA });

    await getIssue('proj', 5);

    const calledHeaders = axios.get.mock.calls[0][1].headers;
    expect(calledHeaders['PRIVATE-TOKEN']).toBe('test-gl-token');
  });

  test('defaults empty description to empty string', async () => {
    axios.get = jest.fn().mockResolvedValue({
      data: { ...MOCK_ISSUE_DATA, description: null },
    });

    const issue = await getIssue('proj', 5);
    expect(issue.description).toBe('');
  });

  test('propagates network errors', async () => {
    axios.get = jest.fn().mockRejectedValue(new Error('Network Error'));

    await expect(getIssue('proj', 5)).rejects.toThrow('Network Error');
  });
});

describe('gitlab.createBranch', () => {
  const MOCK_BRANCH_DATA = { name: 'issue-5-fix-the-login-bug', commit: { id: 'abc123' } };

  test('posts to the correct endpoint', async () => {
    axios.post = jest.fn().mockResolvedValue({ data: MOCK_BRANCH_DATA });

    await createBranch('test-group/test-project', 'issue-5-fix-the-login-bug');

    const calledUrl = axios.post.mock.calls[0][0];
    expect(calledUrl).toContain('/repository/branches');
  });

  test('sends branch name and default ref "main"', async () => {
    axios.post = jest.fn().mockResolvedValue({ data: MOCK_BRANCH_DATA });

    await createBranch('proj', 'my-branch');

    const body = axios.post.mock.calls[0][1];
    expect(body).toMatchObject({ branch: 'my-branch', ref: 'main' });
  });

  test('accepts a custom ref', async () => {
    axios.post = jest.fn().mockResolvedValue({ data: MOCK_BRANCH_DATA });

    await createBranch('proj', 'my-branch', 'develop');

    const body = axios.post.mock.calls[0][1];
    expect(body.ref).toBe('develop');
  });

  test('returns the raw branch data', async () => {
    axios.post = jest.fn().mockResolvedValue({ data: MOCK_BRANCH_DATA });

    const result = await createBranch('proj', 'my-branch');
    expect(result).toEqual(MOCK_BRANCH_DATA);
  });
});

describe('gitlab.createMergeRequest', () => {
  const MOCK_MR_DATA = {
    iid: 1,
    web_url: 'https://gitlab.com/test-group/test-project/-/merge_requests/1',
  };

  test('returns mapped MR fields', async () => {
    axios.post = jest.fn().mockResolvedValue({ data: MOCK_MR_DATA });

    const mr = await createMergeRequest('proj', {
      title: 'Issue #5: Fix login',
      description: 'Closes #5',
      sourceBranch: 'issue-5-fix-the-login-bug',
      targetBranch: 'main',
    });

    expect(mr).toEqual({
      iid: 1,
      webUrl: 'https://gitlab.com/test-group/test-project/-/merge_requests/1',
    });
  });

  test('maps camelCase params to snake_case in the request body', async () => {
    axios.post = jest.fn().mockResolvedValue({ data: MOCK_MR_DATA });

    await createMergeRequest('proj', {
      title: 'My MR',
      description: 'A description',
      sourceBranch: 'feature-branch',
      targetBranch: 'main',
    });

    const body = axios.post.mock.calls[0][1];
    expect(body.source_branch).toBe('feature-branch');
    expect(body.target_branch).toBe('main');
    expect(body.title).toBe('My MR');
  });

  test('propagates API errors', async () => {
    const err = new Error('Forbidden');
    err.response = { status: 403, data: { message: 'Forbidden' } };
    axios.post = jest.fn().mockRejectedValue(err);

    await expect(
      createMergeRequest('proj', {
        title: 'T',
        description: 'D',
        sourceBranch: 'src',
        targetBranch: 'main',
      })
    ).rejects.toThrow('Forbidden');
  });
});
