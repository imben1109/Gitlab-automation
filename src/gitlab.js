'use strict';

const axios = require('axios');
const config = require('./config');

const apiBase = () => `${config.GITLAB_URL}/api/v4`;

const headers = () => ({
  'PRIVATE-TOKEN': config.GITLAB_TOKEN,
  'Content-Type': 'application/json',
});

/**
 * Fetch a GitLab issue by project ID and issue number.
 * @param {string|number} projectId
 * @param {number} issueNumber
 * @returns {{ id, iid, title, description, webUrl }}
 */
async function getIssue(projectId, issueNumber) {
  const encodedId = encodeURIComponent(projectId);
  const { data } = await axios.get(
    `${apiBase()}/projects/${encodedId}/issues/${issueNumber}`,
    { headers: headers() }
  );
  return {
    id: data.id,
    iid: data.iid,
    title: data.title,
    description: data.description || '',
    webUrl: data.web_url,
  };
}

/**
 * Create a branch in a GitLab project.
 * @param {string|number} projectId
 * @param {string} branchName
 * @param {string} ref - the source ref, defaults to 'main'
 */
async function createBranch(projectId, branchName, ref = 'main') {
  const encodedId = encodeURIComponent(projectId);
  const { data } = await axios.post(
    `${apiBase()}/projects/${encodedId}/repository/branches`,
    { branch: branchName, ref },
    { headers: headers() }
  );
  return data;
}

/**
 * Create a Merge Request in a GitLab project.
 * @param {string|number} projectId
 * @param {{ title, description, sourceBranch, targetBranch }} mrData
 * @returns {{ webUrl, iid }}
 */
async function createMergeRequest(projectId, { title, description, sourceBranch, targetBranch }) {
  const encodedId = encodeURIComponent(projectId);
  const { data } = await axios.post(
    `${apiBase()}/projects/${encodedId}/merge_requests`,
    {
      title,
      description,
      source_branch: sourceBranch,
      target_branch: targetBranch,
    },
    { headers: headers() }
  );
  return {
    webUrl: data.web_url,
    iid: data.iid,
  };
}

module.exports = { getIssue, createBranch, createMergeRequest };
