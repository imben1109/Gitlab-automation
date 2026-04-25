'use strict';

import axios from 'axios';
import config = require('./config');

const apiBase = (): string => `${config.GITLAB_URL}/api/v4`;

const headers = (): Record<string, string> => ({
  'PRIVATE-TOKEN': config.GITLAB_TOKEN,
  'Content-Type': 'application/json',
});

export interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string;
  webUrl: string;
}

export interface GitLabBranch {
  name: string;
  commit?: { id: string };
}

export interface GitLabMR {
  webUrl: string;
  iid: number;
}

export interface CreateMRParams {
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
}

/**
 * Fetch a GitLab issue by project ID and issue number.
 */
export async function getIssue(
  projectId: string | number,
  issueNumber: number
): Promise<GitLabIssue> {
  const encodedId = encodeURIComponent(String(projectId));
  const { data } = await axios.get(
    `${apiBase()}/projects/${encodedId}/issues/${issueNumber}`,
    { headers: headers() }
  );
  return {
    id:          data.id,
    iid:         data.iid,
    title:       data.title,
    description: data.description || '',
    webUrl:      data.web_url,
  };
}

/**
 * Create a branch in a GitLab project.
 */
export async function createBranch(
  projectId: string | number,
  branchName: string,
  ref = 'main'
): Promise<GitLabBranch> {
  const encodedId = encodeURIComponent(String(projectId));
  const { data } = await axios.post(
    `${apiBase()}/projects/${encodedId}/repository/branches`,
    { branch: branchName, ref },
    { headers: headers() }
  );
  return data as GitLabBranch;
}

/**
 * Create a Merge Request in a GitLab project.
 */
export async function createMergeRequest(
  projectId: string | number,
  { title, description, sourceBranch, targetBranch }: CreateMRParams
): Promise<GitLabMR> {
  const encodedId = encodeURIComponent(String(projectId));
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
    iid:    data.iid,
  };
}
