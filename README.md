# GitLab Automation with GitHub Copilot

Automate your GitLab issue workflow using GitHub Copilot AI. Given a GitLab issue number, this tool:

1. Fetches the issue details from GitLab
2. Creates a new branch named `issue-<number>-<title-slug>`
3. Asks GitHub Copilot to generate an implementation plan
4. Displays the plan and optionally commits & pushes changes
5. Creates a GitLab Merge Request with the Copilot plan and issue link

## Prerequisites

- **Node.js** ≥ 18 (for the primary CLI)
- **Git** installed and configured
- **GitLab account** with a personal access token (scope: `api`)
- **GitHub Copilot subscription** and a GitHub personal access token

## Setup

```bash
# 1. Clone the repository
git clone https://github.com/imben1109/Gitlab-automation.git
cd Gitlab-automation

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and fill in your credentials
```

## Configuration

Copy `.env.example` to `.env` and set the following variables:

| Variable | Required | Description |
|---|---|---|
| `GITLAB_URL` | No | GitLab instance URL (default: `https://gitlab.com`) |
| `GITLAB_TOKEN` | **Yes** | GitLab personal access token (scope: `api`) |
| `GITLAB_PROJECT_ID` | **Yes** | Project ID or `namespace/project` path |
| `GITHUB_TOKEN` | **Yes** | GitHub token with Copilot access |
| `TARGET_REPO_PATH` | No | Local path to the git repo (defaults to cwd) |

## Usage

### Node.js (primary)

```bash
# Process issue #42
node bin/gitlab-auto.js 42

# Skip confirmation prompt
node bin/gitlab-auto.js 42 --auto-confirm

# Specify a local repo path
node bin/gitlab-auto.js 42 --repo-path=/path/to/repo
```

### npx (no install)

```bash
npx gitlab-automation 42
```

### Bash script (curl + git, Node optional)

```bash
chmod +x scripts/gitlab-automation.sh
./scripts/gitlab-automation.sh 42
```

### PowerShell script (Windows / cross-platform)

```powershell
./scripts/gitlab-automation.ps1 -IssueNumber 42

# Skip confirmation
./scripts/gitlab-automation.ps1 -IssueNumber 42 -AutoConfirm
```

## Workflow

```
GitLab Issue → Fetch details
             → Build branch name (issue-<iid>-<slug>)
             → Create branch via GitLab API
             → Checkout branch locally (if repo path set)
             → Ask GitHub Copilot for implementation plan
             → Display plan
             → Confirm → Commit & push changes
             → Create Merge Request with plan + issue link
```

## Project Structure

```
├── bin/
│   └── gitlab-auto.js          CLI entry point
├── src/
│   ├── config.js               Environment config loader
│   ├── gitlab.js               GitLab REST API client
│   ├── copilot.js              GitHub Copilot Chat API client
│   ├── git.js                  Git operations (simple-git)
│   └── workflow.js             Orchestrates the full workflow
├── scripts/
│   ├── gitlab-automation.sh    Bash standalone script
│   └── gitlab-automation.ps1   PowerShell standalone script
├── .env.example                Environment variable template
└── package.json
```