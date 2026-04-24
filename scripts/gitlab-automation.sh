#!/usr/bin/env bash
# gitlab-automation.sh — Standalone bash wrapper for GitLab issue automation.
# Works with curl + git; if Node.js is available, delegates to bin/gitlab-auto.js.

set -euo pipefail

# ── helpers ─────────────────────────────────────────────────────────────────

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "INFO:  $*"; }

# ── validate env vars ────────────────────────────────────────────────────────

: "${GITLAB_URL:?Missing GITLAB_URL}"
: "${GITLAB_TOKEN:?Missing GITLAB_TOKEN}"
: "${GITLAB_PROJECT_ID:?Missing GITLAB_PROJECT_ID}"
: "${GITHUB_TOKEN:?Missing GITHUB_TOKEN}"

# ── parse args ───────────────────────────────────────────────────────────────

ISSUE_NUMBER="${1:-}"
[ -z "$ISSUE_NUMBER" ] && { echo "Usage: $0 <issue-number>"; exit 1; }
[[ "$ISSUE_NUMBER" =~ ^[0-9]+$ ]] || die "issue-number must be a positive integer"

ENCODED_PROJECT=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1],''))" "$GITLAB_PROJECT_ID" 2>/dev/null \
  || node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$GITLAB_PROJECT_ID" 2>/dev/null \
  || echo "$GITLAB_PROJECT_ID" | sed 's|/|%2F|g')
# NOTE: the sed fallback only encodes '/' — if your project ID contains other
# special characters and neither python3 nor node is available, set GITLAB_PROJECT_ID
# to the numeric project ID instead of the namespace/project path.

API_BASE="${GITLAB_URL%/}/api/v4"

# ── fetch issue ──────────────────────────────────────────────────────────────

info "Fetching issue #${ISSUE_NUMBER} from GitLab..."
ISSUE_JSON=$(curl -sf \
  -H "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  "${API_BASE}/projects/${ENCODED_PROJECT}/issues/${ISSUE_NUMBER}") \
  || die "Failed to fetch issue #${ISSUE_NUMBER}"

ISSUE_TITLE=$(echo "$ISSUE_JSON" | grep -o '"title":"[^"]*"' | head -1 | sed 's/"title":"//;s/"$//')
ISSUE_IID=$(echo "$ISSUE_JSON"   | grep -o '"iid":[0-9]*'   | head -1 | sed 's/"iid"://')
ISSUE_URL=$(echo "$ISSUE_JSON"   | grep -o '"web_url":"[^"]*"' | head -1 | sed 's/"web_url":"//;s/"$//')

[ -z "$ISSUE_TITLE" ] && die "Could not parse issue title"
info "Issue: ${ISSUE_TITLE}"

# ── build branch name ────────────────────────────────────────────────────────

slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9 -]//g; s/  */ /g; s/ /-/g; s/^-//; s/-$//'
}

BRANCH_NAME="issue-${ISSUE_IID}-$(slugify "$ISSUE_TITLE")"
info "Branch name: ${BRANCH_NAME}"

# ── create branch via GitLab API ─────────────────────────────────────────────

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
  : # success — response contains branch name
else
  die "Failed to create branch: ${BRANCH_RESP}"
fi

# ── local git checkout ───────────────────────────────────────────────────────

if git rev-parse --is-inside-work-tree &>/dev/null; then
  info "Checking out branch locally..."
  git checkout -b "$BRANCH_NAME" 2>/dev/null \
    || info "Branch already exists locally, skipping checkout."
fi

# ── delegate to Node.js if available ─────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_ENTRY="${SCRIPT_DIR}/../bin/gitlab-auto.js"

if command -v node &>/dev/null && [ -f "$NODE_ENTRY" ]; then
  info "Node.js found — delegating to gitlab-auto.js..."
  node "$NODE_ENTRY" "$ISSUE_NUMBER" "$@"
  exit $?
fi

info "Node.js not found — performing minimal workflow via curl."

# ── fallback: create MR via curl ─────────────────────────────────────────────

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
