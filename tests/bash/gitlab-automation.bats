#!/usr/bin/env bats
# Unit / integration tests for scripts/gitlab-automation.sh
# Requires: bats >= 1.0  (https://github.com/bats-core/bats-core)
#
# Run:
#   bats tests/bash/gitlab-automation.bats

REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/gitlab-automation.sh"

# ── per-test setup / teardown ─────────────────────────────────────────────────

setup() {
  STUB_DIR="$(mktemp -d)"
  export GITLAB_URL="https://gitlab.example.com"
  export GITLAB_TOKEN="test-gl-token"
  export GITLAB_PROJECT_ID="mygroup/myproject"
  export GITHUB_TOKEN="test-gh-token"
}

teardown() {
  rm -rf "$STUB_DIR"
}

# ── helpers ───────────────────────────────────────────────────────────────────

# Write an executable stub script to $STUB_DIR/<name>.
make_stub() {
  local name="$1"
  local body="$2"
  printf '#!/usr/bin/env bash\n%s\n' "$body" > "$STUB_DIR/$name"
  chmod +x "$STUB_DIR/$name"
}

# Prepend $STUB_DIR to PATH and run the main script with the given arguments.
run_script() {
  PATH="$STUB_DIR:$PATH" run bash "$SCRIPT" "$@"
}

# Source only the `slugify` helper from the script under test (no side-effects).
load_slugify() {
  # shellcheck disable=SC1090
  source <(sed -n '/^slugify()/,/^}/p' "$SCRIPT")
}

# ── slugify unit tests ────────────────────────────────────────────────────────

@test "slugify: lowercases input" {
  load_slugify
  [ "$(slugify 'Hello World')" = "hello-world" ]
}

@test "slugify: replaces spaces with hyphens" {
  load_slugify
  [ "$(slugify 'fix the login bug')" = "fix-the-login-bug" ]
}

@test "slugify: removes special characters" {
  load_slugify
  [ "$(slugify 'Fix: bug!')" = "fix-bug" ]
}

@test "slugify: handles numeric characters" {
  load_slugify
  [ "$(slugify 'Issue 42 Fix')" = "issue-42-fix" ]
}

@test "slugify: returns empty string for all-special input" {
  load_slugify
  [ "$(slugify '!!!@@@###')" = "" ]
}

@test "slugify: collapses multiple spaces" {
  load_slugify
  [ "$(slugify 'fix  the  bug')" = "fix-the-bug" ]
}

@test "slugify: trims leading and trailing hyphens" {
  load_slugify
  [ "$(slugify '-fix-bug-')" = "fix-bug" ]
}

# ── argument validation ───────────────────────────────────────────────────────

@test "exits 1 with no arguments and prints usage" {
  run bash "$SCRIPT" 2>&1
  [ "$status" -eq 1 ]
  [[ "$output" == *"Usage:"* ]]
}

@test "exits with error for non-integer issue number" {
  run bash "$SCRIPT" abc 2>&1
  [ "$status" -ne 0 ]
}

# ── env var validation ────────────────────────────────────────────────────────

@test "exits with error when GITLAB_URL is missing" {
  unset GITLAB_URL
  run bash "$SCRIPT" 42 2>&1
  [ "$status" -ne 0 ]
}

@test "exits with error when GITLAB_TOKEN is missing" {
  unset GITLAB_TOKEN
  run bash "$SCRIPT" 42 2>&1
  [ "$status" -ne 0 ]
}

@test "exits with error when GITLAB_PROJECT_ID is missing" {
  unset GITLAB_PROJECT_ID
  run bash "$SCRIPT" 42 2>&1
  [ "$status" -ne 0 ]
}

# ── Node.js delegation path ───────────────────────────────────────────────────

# When `node` is on PATH and bin/gitlab-auto.js exists the script delegates to
# the Node CLI.  We stub `node` so it acts as a no-op when invoked with a .js
# file, and handles the encodeURIComponent call otherwise.
setup_node_stubs() {
  make_stub git 'exit 1'
  make_stub curl '
    args="$*"
    if   echo "$args" | grep -q "issues/42"; then
      echo '"'"'{"id":1,"iid":42,"title":"Fix navbar","description":"Broken","web_url":"https://gitlab.example.com/g/p/-/issues/42"}'"'"'
    elif echo "$args" | grep -q "branches"; then
      echo '"'"'{"name":"issue-42-fix-navbar"}'"'"'
    else
      echo '"'"'{}'"'"'
    fi
  '
  cat > "$STUB_DIR/node" << 'EOF'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" == *.js ]]; then
    echo "INFO:  (stub) Node.js delegation succeeded"
    exit 0
  fi
done
# encodeURIComponent: last positional arg is the project ID
printf '%s' "${@: -1}" | sed 's|/|%2F|g'
EOF
  chmod +x "$STUB_DIR/node"
}

@test "delegates to Node.js when node and gitlab-auto.js are available" {
  setup_node_stubs
  run_script 42 2>&1
  [ "$status" -eq 0 ]
  [[ "$output" == *"delegating to gitlab-auto.js"* ]]
}

@test "delegation: fetches issue before handing off to Node" {
  setup_node_stubs
  run_script 42 2>&1
  [[ "$output" == *"Fetching issue #42"* ]]
}

# ── curl fallback path (no Node.js) ──────────────────────────────────────────

# Run with a restricted PATH that excludes the real node binary so the script
# uses the pure-curl fallback path.
ISSUE_JSON='{"id":1,"iid":42,"title":"Fix navbar","description":"Broken","web_url":"https://gitlab.example.com/g/p/-/issues/42"}'
BRANCH_JSON='{"name":"issue-42-fix-navbar"}'
MR_JSON='{"iid":1,"web_url":"https://gitlab.example.com/g/p/-/merge_requests/1"}'

setup_curl_stubs() {
  make_stub git 'exit 1'
  cat > "$STUB_DIR/curl" << 'EOF'
#!/usr/bin/env bash
args="$*"
if   echo "$args" | grep -q "issues/42"; then
  echo '{"id":1,"iid":42,"title":"Fix navbar","description":"Broken","web_url":"https://gitlab.example.com/g/p/-/issues/42"}'
elif echo "$args" | grep -q "branches"; then
  echo '{"name":"issue-42-fix-navbar"}'
elif echo "$args" | grep -q "merge_requests"; then
  echo '{"iid":1,"web_url":"https://gitlab.example.com/g/p/-/merge_requests/1"}'
else
  echo '{}'
fi
EOF
  chmod +x "$STUB_DIR/curl"
}

run_no_node() {
  # Restrict PATH to stubs + basic system utilities, excluding /usr/local/bin
  # where the real `node` binary lives.
  PATH="$STUB_DIR:/usr/bin:/bin" run bash "$SCRIPT" "$@" 2>&1
}

@test "curl fallback: exits 0 on successful workflow" {
  setup_curl_stubs
  run_no_node 42
  [ "$status" -eq 0 ]
}

@test "curl fallback: prints Fetching issue INFO message" {
  setup_curl_stubs
  run_no_node 42
  [[ "$output" == *"Fetching issue #42"* ]]
}

@test "curl fallback: prints Merge Request created message" {
  setup_curl_stubs
  run_no_node 42
  [[ "$output" == *"Merge Request created"* ]]
}

@test "curl fallback: exits with error when issue fetch fails" {
  make_stub git 'exit 1'
  make_stub curl 'exit 6'   # simulate curl connection error
  run_no_node 42
  [ "$status" -ne 0 ]
}

@test "curl fallback: continues when branch already exists" {
  make_stub git 'exit 1'
  cat > "$STUB_DIR/curl" << 'EOF'
#!/usr/bin/env bash
args="$*"
if echo "$args" | grep -q "issues/42"; then
  echo '{"id":1,"iid":42,"title":"Fix navbar","description":"","web_url":"https://gitlab.example.com/g/p/-/issues/42"}'
elif echo "$args" | grep -q "branches"; then
  echo '{"message":"Branch already exists"}'
elif echo "$args" | grep -q "merge_requests"; then
  echo '{"iid":1,"web_url":"https://gitlab.example.com/g/p/-/merge_requests/1"}'
else
  echo '{}'
fi
EOF
  chmod +x "$STUB_DIR/curl"
  run_no_node 42
  [ "$status" -eq 0 ]
  [[ "$output" == *"already exists"* ]]
}
