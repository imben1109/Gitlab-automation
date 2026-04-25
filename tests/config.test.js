'use strict';

// Mock dotenv so it doesn't try to load a real .env file.
jest.mock('dotenv', () => ({ config: jest.fn() }));

describe('config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function loadConfig() {
    return require('../src/config');
  }

  test('loads successfully when all required vars are set', () => {
    process.env.GITLAB_TOKEN = 'gl-token';
    process.env.GITLAB_PROJECT_ID = 'namespace/project';
    process.env.GITHUB_TOKEN = 'gh-token';
    process.env.GITLAB_URL = 'https://mygitlab.example.com';
    process.env.TARGET_REPO_PATH = '/tmp/myrepo';

    const config = loadConfig();

    expect(config.GITLAB_TOKEN).toBe('gl-token');
    expect(config.GITLAB_PROJECT_ID).toBe('namespace/project');
    expect(config.GITHUB_TOKEN).toBe('gh-token');
    expect(config.GITLAB_URL).toBe('https://mygitlab.example.com');
    expect(config.TARGET_REPO_PATH).toBe('/tmp/myrepo');
  });

  test('defaults GITLAB_URL to https://gitlab.com when not set', () => {
    delete process.env.GITLAB_URL;
    process.env.GITLAB_TOKEN = 'gl-token';
    process.env.GITLAB_PROJECT_ID = 'proj';
    process.env.GITHUB_TOKEN = 'gh-token';

    const config = loadConfig();
    expect(config.GITLAB_URL).toBe('https://gitlab.com');
  });

  test('defaults TARGET_REPO_PATH to process.cwd() when not set', () => {
    delete process.env.TARGET_REPO_PATH;
    process.env.GITLAB_TOKEN = 'gl-token';
    process.env.GITLAB_PROJECT_ID = 'proj';
    process.env.GITHUB_TOKEN = 'gh-token';

    const config = loadConfig();
    expect(config.TARGET_REPO_PATH).toBe(process.cwd());
  });

  test('throws when GITLAB_TOKEN is missing', () => {
    delete process.env.GITLAB_TOKEN;
    process.env.GITLAB_PROJECT_ID = 'proj';
    process.env.GITHUB_TOKEN = 'gh-token';

    expect(loadConfig).toThrow('GITLAB_TOKEN');
  });

  test('throws when GITLAB_PROJECT_ID is missing', () => {
    process.env.GITLAB_TOKEN = 'gl-token';
    delete process.env.GITLAB_PROJECT_ID;
    process.env.GITHUB_TOKEN = 'gh-token';

    expect(loadConfig).toThrow('GITLAB_PROJECT_ID');
  });

  test('throws when GITHUB_TOKEN is missing', () => {
    process.env.GITLAB_TOKEN = 'gl-token';
    process.env.GITLAB_PROJECT_ID = 'proj';
    delete process.env.GITHUB_TOKEN;

    expect(loadConfig).toThrow('GITHUB_TOKEN');
  });

  test('error message includes .env.example hint', () => {
    delete process.env.GITLAB_TOKEN;
    process.env.GITLAB_PROJECT_ID = 'proj';
    process.env.GITHUB_TOKEN = 'gh-token';

    expect(loadConfig).toThrow('.env.example');
  });
});
