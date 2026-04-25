# GitLab Automation — Human-in-the-Loop

A two-step CLI tool that bridges GitLab issue tracking and your local development workflow. It keeps you in control: start a branch from an issue, plan and code at your own pace, then commit and open a Merge Request with a single command.

## Workflow

```
Step 1 — start
  Fetch issue → verify main is up-to-date → create feature branch
  → checkout locally → export issue to issue-<iid>.md

  ↓ (you plan, implement, and track progress in issue-<iid>.md)

Step 2 — finish
  Commit all changes with "feat: issue #<iid> - <title>"
  → push branch → create Merge Request (description links to the issue)
```

## Prerequisites

- **Node.js** ≥ 18 (for the primary CLI)
- **Git** installed and configured
- **GitLab account** with a personal access token (scope: `api`)

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
| `TARGET_REPO_PATH` | No | Local path to the git repo (defaults to cwd) |

## Usage

### Node.js (primary)

```bash
# Build first
npm run build

# Step 1: start working on issue #42
node dist/cli.js start 42

# Step 2: after making your changes, commit and open a MR
node dist/cli.js finish 42

# Specify a local repo path
node dist/cli.js start 42 --repo-path=/path/to/repo
node dist/cli.js finish 42 --repo-path=/path/to/repo
```

### npx (no install)

```bash
npx gitlab-automation start 42
# ... make your changes ...
npx gitlab-automation finish 42
```

### Bash script (bash + curl + git, no external dependencies)

```bash
chmod +x scripts/gitlab-automation.sh

# Step 1: start
./scripts/gitlab-automation.sh start 42

# Step 2: finish
./scripts/gitlab-automation.sh finish 42
```

### PowerShell script (Windows / cross-platform)

```powershell
# Step 1: start
./scripts/gitlab-automation.ps1 -Command start -IssueNumber 42

# Step 2: finish
./scripts/gitlab-automation.ps1 -Command finish -IssueNumber 42
```

## Issue Markdown File

After running `start`, an `issue-<iid>.md` file is created in your repo:

```markdown
# Issue #42: Fix the navbar

**URL:** https://gitlab.com/mygroup/myproject/-/issues/42
**Branch:** issue-42-fix-the-navbar

## Description

The navbar breaks on mobile.

## Planning

<!-- Add your implementation plan here -->

## Progress

- [ ] 
```

Edit this file to track your plan and progress before running `finish`.

## Project Structure

```
├── src/
│   ├── cli.ts                  CLI entry point (compiled → dist/cli.js)
│   ├── config.ts               Environment config loader
│   ├── gitlab.ts               GitLab REST API client
│   ├── git.ts                  Git operations (simple-git)
│   └── workflow.ts             start() and finish() orchestration
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