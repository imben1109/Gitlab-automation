'use strict';

import dotenv = require('dotenv');
dotenv.config();

interface Config {
  readonly GITLAB_URL: string;
  readonly GITLAB_TOKEN: string;
  readonly GITLAB_PROJECT_ID: string;
  readonly GITHUB_TOKEN: string;
  readonly TARGET_REPO_PATH: string;
}

const raw = {
  GITLAB_URL:        process.env.GITLAB_URL        || 'https://gitlab.com',
  GITLAB_TOKEN:      process.env.GITLAB_TOKEN,
  GITLAB_PROJECT_ID: process.env.GITLAB_PROJECT_ID,
  GITHUB_TOKEN:      process.env.GITHUB_TOKEN,
  TARGET_REPO_PATH:  process.env.TARGET_REPO_PATH  || process.cwd(),
};

const required = ['GITLAB_TOKEN', 'GITLAB_PROJECT_ID', 'GITHUB_TOKEN'] as const;
for (const key of required) {
  if (!raw[key]) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Copy .env.example to .env and fill in your credentials.`
    );
  }
}

const config = raw as Config;
export = config;
