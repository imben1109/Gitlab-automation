'use strict';

require('dotenv').config();

const config = {
  GITLAB_URL: process.env.GITLAB_URL || 'https://gitlab.com',
  GITLAB_TOKEN: process.env.GITLAB_TOKEN,
  GITLAB_PROJECT_ID: process.env.GITLAB_PROJECT_ID,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  TARGET_REPO_PATH: process.env.TARGET_REPO_PATH || process.cwd(),
};

const required = ['GITLAB_TOKEN', 'GITLAB_PROJECT_ID', 'GITHUB_TOKEN'];
for (const key of required) {
  if (!config[key]) {
    throw new Error(
      `Missing required environment variable: ${key}\n` +
      `Copy .env.example to .env and fill in your credentials.`
    );
  }
}

module.exports = config;
