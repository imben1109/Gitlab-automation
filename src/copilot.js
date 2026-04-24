'use strict';

const axios = require('axios');
const config = require('./config');

const COPILOT_API_URL = 'https://api.githubcopilot.com/chat/completions';

/**
 * Call the GitHub Copilot Chat API to generate an implementation plan for a GitLab issue.
 * @param {string} issueTitle
 * @param {string} issueDescription
 * @returns {Promise<string>} The plan text from Copilot
 */
async function generatePlan(issueTitle, issueDescription) {
  const systemPrompt =
    'You are a senior software developer. Given a GitLab issue, you will:\n' +
    '1. Produce a concise implementation plan (step-by-step).\n' +
    '2. List the files that are likely to need changes.\n' +
    '3. Provide relevant code snippets where helpful.\n' +
    'Be practical and specific.';

  const userMessage =
    `Issue Title: ${issueTitle}\n\n` +
    `Issue Description:\n${issueDescription || '(no description provided)'}`;

  const response = await axios.post(
    COPILOT_API_URL,
    {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${config.GITHUB_TOKEN}`,
        'Content-Type': 'application/json',
        'Editor-Version': 'vscode/1.85.0',
        'Copilot-Integration-Id': 'vscode-chat',
      },
    }
  );

  const choice = response.data.choices && response.data.choices[0];
  if (!choice || !choice.message) {
    throw new Error('No response from Copilot API');
  }
  return choice.message.content;
}

module.exports = { generatePlan };
