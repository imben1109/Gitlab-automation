'use strict';

import axios from 'axios';
import config = require('./config');

const COPILOT_API_URL = 'https://api.githubcopilot.com/chat/completions';
const EDITOR_VERSION  = process.env.COPILOT_EDITOR_VERSION || 'vscode/1.85.0';

/**
 * Call the GitHub Copilot Chat API to generate an implementation plan for a
 * GitLab issue.
 */
export async function generatePlan(
  issueTitle: string,
  issueDescription: string
): Promise<string> {
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
        { role: 'system',  content: systemPrompt },
        { role: 'user',    content: userMessage  },
      ],
    },
    {
      headers: {
        Authorization:           `Bearer ${config.GITHUB_TOKEN}`,
        'Content-Type':          'application/json',
        'Editor-Version':        EDITOR_VERSION,
        'Copilot-Integration-Id': 'vscode-chat',
      },
    }
  );

  const choice =
    response.data.choices && (response.data.choices as { message?: { content: string } }[])[0];
  if (!choice || !choice.message) {
    throw new Error('No response from Copilot API');
  }
  return choice.message.content;
}
