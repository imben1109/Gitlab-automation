'use strict';

jest.mock('../src/config', () => ({
  GITLAB_URL: 'https://gitlab.com',
  GITLAB_TOKEN: 'test-gl-token',
  GITLAB_PROJECT_ID: 'test-group/test-project',
  GITHUB_TOKEN: 'test-gh-token',
  TARGET_REPO_PATH: '/tmp/repo',
}));

jest.mock('axios');

const axios = require('axios');
const { generatePlan } = require('../src/copilot');

const MOCK_PLAN_TEXT = '1. Update auth service\n2. Add SSO callback route\n3. Write tests';

function mockCopilotResponse(content) {
  return {
    data: {
      choices: [{ message: { content } }],
    },
  };
}

describe('copilot.generatePlan', () => {
  beforeEach(() => {
    axios.post = jest.fn();
  });

  test('returns the plan text from the API response', async () => {
    axios.post.mockResolvedValue(mockCopilotResponse(MOCK_PLAN_TEXT));

    const result = await generatePlan('Fix SSO login', 'Users cannot log in via SSO.');
    expect(result).toBe(MOCK_PLAN_TEXT);
  });

  test('calls the Copilot API endpoint', async () => {
    axios.post.mockResolvedValue(mockCopilotResponse(MOCK_PLAN_TEXT));

    await generatePlan('My issue', 'Description');

    const url = axios.post.mock.calls[0][0];
    expect(url).toBe('https://api.githubcopilot.com/chat/completions');
  });

  test('sends gpt-4o model', async () => {
    axios.post.mockResolvedValue(mockCopilotResponse(MOCK_PLAN_TEXT));

    await generatePlan('My issue', 'Description');

    const body = axios.post.mock.calls[0][1];
    expect(body.model).toBe('gpt-4o');
  });

  test('includes system and user messages', async () => {
    axios.post.mockResolvedValue(mockCopilotResponse(MOCK_PLAN_TEXT));

    await generatePlan('My issue', 'Some description');

    const { messages } = axios.post.mock.calls[0][1];
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('My issue');
    expect(messages[1].content).toContain('Some description');
  });

  test('includes issue title and description in user message', async () => {
    axios.post.mockResolvedValue(mockCopilotResponse(MOCK_PLAN_TEXT));

    await generatePlan('Add dark mode', 'Allow users to toggle dark mode in settings.');

    const { messages } = axios.post.mock.calls[0][1];
    const userMsg = messages[1].content;
    expect(userMsg).toContain('Add dark mode');
    expect(userMsg).toContain('Allow users to toggle dark mode in settings.');
  });

  test('falls back to "(no description provided)" when description is empty', async () => {
    axios.post.mockResolvedValue(mockCopilotResponse(MOCK_PLAN_TEXT));

    await generatePlan('Untitled issue', '');

    const { messages } = axios.post.mock.calls[0][1];
    expect(messages[1].content).toContain('(no description provided)');
  });

  test('uses Authorization Bearer header with GITHUB_TOKEN', async () => {
    axios.post.mockResolvedValue(mockCopilotResponse(MOCK_PLAN_TEXT));

    await generatePlan('issue', 'desc');

    const headers = axios.post.mock.calls[0][2].headers;
    expect(headers.Authorization).toBe('Bearer test-gh-token');
  });

  test('throws when response has no choices', async () => {
    axios.post.mockResolvedValue({ data: { choices: [] } });

    await expect(generatePlan('issue', 'desc')).rejects.toThrow(
      'No response from Copilot API'
    );
  });

  test('throws when choices[0].message is absent', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{}] } });

    await expect(generatePlan('issue', 'desc')).rejects.toThrow(
      'No response from Copilot API'
    );
  });

  test('propagates network errors', async () => {
    axios.post.mockRejectedValue(new Error('Network Error'));

    await expect(generatePlan('issue', 'desc')).rejects.toThrow('Network Error');
  });
});
