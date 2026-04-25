#!/usr/bin/env bash
# gitlab-automation.sh — Human-in-the-loop GitLab issue automation.
# Requires only: bash, curl, git, sed — no Node.js, no Python.
#
# Usage:
#   ./gitlab-automation.sh start  <issue-number>   # fetch issue, create branch, export markdown
#   ./gitlab-automation.sh finish <issue-number>   # commit changes, open Merge Request

set -euo pipefail

# ── helpers ─────────────────────────────────────────────────────────────────

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "INFO:  $*"; }

# ── validate env vars ────────────────────────────────────────────────────────

: "${GITLAB_URL:?Missing GITLAB_URL}"
: "${GITLAB_TOKEN:?Missing GITLAB_TOKEN}"
: "${GITLAB_PROJECT_ID:?Missing GITLAB_PROJECT_ID}"

# ── parse args ───────────────────────────────────────────────────────────────

COMMAND="${1:-}"
ISSUE_NUMBER="${2:-}"

if [ -z "$COMMAND" ] || [ "$COMMAND" = "--help" ] || [ "$COMMAND" = "-h" ]; then
  echo "Usage:"
  echo "  $0 start  <issue-number>   Fetch issue, create branch, export to Markdown"
  echo "  $0 finish <issue-number>   Commit changes and open a Merge Request"
  exit 1
fi

[ "$COMMAND" = "start" ] || [ "$COMMAND" = "finish" ] \
  || die "Unknown command: ${COMMAND}. Expected 'start' or 'finish'."

[ -z "$ISSUE_NUMBER" ] && die "issue-number is required. Usage: $0 ${COMMAND} <issue-number>"
[[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]] || die "issue-number must be a positive integer"

# URL-encode the project ID (encode '/' as '%2F' for namespace/project paths).
ENCODED_PROJECT=$(printf '%s' "$GITLAB_PROJECT_ID" | sed 's|/|%2F|g')
API_BASE="${GITLAB_URL%/}/api/v4"

# ── slugify ──────────────────────────────────────────────────────────────────

slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9 -]//g; s/  */ /g; s/ /-/g; s/^-//; s/-$//'
}

# ── shared: fetch issue ───────────────────────────────────────────────────────

fetch_issue() {
  info "Fetching issue #${ISSUE_NUMBER} from GitLab..."
  ISSUE_JSON=$(curl -sf \
    -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
    "${API_BASE}/projects/${ENCODED_PROJECT}/issues/${ISSUE_NUMBER}") \
    || die "Failed to fetch issue #${ISSUE_NUMBER}"

  ISSUE_TITLE=$(echo "$ISSUE_JSON" | grep -o '"title":"[^"]*"'   | head -1 | sed 's/"title":"//;s/"$//')
  ISSUE_IID=$(echo "$ISSUE_JSON"   | grep -o '"iid":[0-9]*'      | head -1 | sed 's/"iid"://')
  ISSUE_URL=$(echo "$ISSUE_JSON"   | grep -o '"web_url":"[^"]*"' | head -1 | sed 's/"web_url":"//;s/"$//')
  ISSUE_DESC=$(echo "$ISSUE_JSON"  | grep -o '"description":"[^"]*"' | head -1 | sed 's/"description":"//;s/"$//')

  [ -z "$ISSUE_TITLE" ] && die "Could not parse issue title"
  info "Issue: ${ISSUE_TITLE}"

  BRANCH_NAME="issue-${ISSUE_IID}-$(slugify "$ISSUE_TITLE")"
  info "Branch name: ${BRANCH_NAME}"
}

# ── command: start ────────────────────────────────────────────────────────────

cmd_start() {
  fetch_issue

  # Check that the current branch is main and up-to-date
  if git rev-parse --is-inside-work-tree &>/dev/null; then
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
    if [ "$CURRENT_BRANCH" != "main" ]; then
      die "Expected to be on 'main' branch, but currently on '${CURRENT_BRANCH}'. Switch to main before starting."
    fi
    info "Fetching latest changes from origin/main..."
    git fetch origin main 2>/dev/null || info "Warning: could not fetch from origin."
    BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)
    if [ "$BEHIND" -gt 0 ]; then
      die "Local main is ${BEHIND} commit(s) behind origin/main. Please run 'git pull' before starting."
    fi
    info "Local main is up-to-date."
  fi

  # Create branch via GitLab API
  info "Creating branch on GitLab..."
  BRANCH_RESP=$(curl -s \
    -X POST \
    -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"branch\":\"${BRANCH_NAME}\",\"ref\":\"main\"}" \
    "${API_BASE}/projects/${ENCODED_PROJECT}/repository/branches")
  if echo "$BRANCH_RESP" | grep -qi "already exists"; then
    info "Branch already exists, continuing..."
  elif echo "$BRANCH_RESP" | grep -qi '"name"'; then
    info "Branch created: ${BRANCH_NAME}"
  else
    die "Failed to create branch: ${BRANCH_RESP}"
  fi

  # Checkout branch locally
  if git rev-parse --is-inside-work-tree &>/dev/null; then
    info "Checking out branch locally..."
    git checkout -b "$BRANCH_NAME" 2>/dev/null \
      || info "Branch already exists locally, skipping checkout."
  fi

  # Export issue to Markdown file
  MARKDOWN_FILE="issue-${ISSUE_IID}.md"
  cat > "$MARKDOWN_FILE" << MARKDOWN
# Issue #${ISSUE_IID}: ${ISSUE_TITLE}

**URL:** ${ISSUE_URL}
**Branch:** ${BRANCH_NAME}

## Description

${ISSUE_DESC:-_No description provided._}

## Planning

<!-- Add your implementation plan here -->

## Progress

- [ ] Add your first task here
MARKDOWN

  info "Issue exported to ${MARKDOWN_FILE}"
  echo ""
  echo "Next steps:"
  echo "  1. Review and update ${MARKDOWN_FILE}"
  echo "  2. Make your changes in the codebase"
  echo "  3. Run: $0 finish ${ISSUE_NUMBER}"
}

# ── command: finish ───────────────────────────────────────────────────────────

cmd_finish() {
  fetch_issue

  # Commit and push all changes
  info "Committing and pushing changes..."
  git add .
  git commit -m "feat: issue #${ISSUE_IID} - ${ISSUE_TITLE}" \
    || die "Nothing to commit. Make your changes before running finish."
  git push origin "$BRANCH_NAME" --set-upstream \
    || die "Failed to push branch ${BRANCH_NAME} to origin."
  info "Changes committed and pushed."

  # Create Merge Request
  info "Creating Merge Request on GitLab..."
  MR_BODY="{
  \"title\": \"Issue #${ISSUE_IID}: ${ISSUE_TITLE}\",
  \"description\": \"Related issue: ${ISSUE_URL}\",
  \"source_branch\": \"${BRANCH_NAME}\",
  \"target_branch\": \"main\"
}"

  MR_JSON=$(curl -sf \
    -X POST \
    -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$MR_BODY" \
    "${API_BASE}/projects/${ENCODED_PROJECT}/merge_requests") \
    || die "Failed to create Merge Request"

  MR_URL=$(echo "$MR_JSON" | grep -o '"web_url":"[^"]*"' | head -1 | sed 's/"web_url":"//;s/"$//')
  info "Merge Request created: ${MR_URL}"
}

# ── dispatch ──────────────────────────────────────────────────────────────────

case "$COMMAND" in
  start)  cmd_start  ;;
  finish) cmd_finish ;;
esac
