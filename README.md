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
# Build first
npm run build

# Process issue #42
node dist/cli.js 42

# Skip confirmation prompt
node dist/cli.js 42 --auto-confirm

# Specify a local repo path
node dist/cli.js 42 --repo-path=/path/to/repo
```

### npx (no install)

```bash
npx gitlab-automation 42
```

### Bash script (bash + curl + git, no external dependencies)

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
├── src/
│   ├── cli.ts                  CLI entry point (compiled → dist/cli.js)
│   ├── config.ts               Environment config loader
│   ├── gitlab.ts               GitLab REST API client
│   ├── copilot.ts              GitHub Copilot Chat API client
│   ├── git.ts                  Git operations (simple-git)
│   └── workflow.ts             Orchestrates the full workflow
├── scripts/
│   ├── gitlab-automation.sh    Bash standalone script (bash/curl/sed only)
│   └── gitlab-automation.ps1   PowerShell standalone script
├── tests/
│   ├── bash/                   bats tests for the bash script
│   └── powershell/             Pester tests for the PowerShell script
├── tsconfig.json               TypeScript compiler configuration
├── .env.example                Environment variable template
└── package.json
```

Build TypeScript source:

```bash
npm run build   # compiles src/ → dist/
```