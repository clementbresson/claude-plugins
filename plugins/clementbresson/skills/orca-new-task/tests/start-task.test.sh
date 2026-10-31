#!/bin/bash
# Tests start-task.sh against a stub orca and real temporary git repos.
# Usage: bash tests/start-task.test.sh
set -u

here=$(cd "$(dirname "$0")" && pwd -P)
script="$here/../scripts/start-task.sh"
root=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$root"' EXIT
failures=0
count=0

# Only these tools are on PATH, so a real orca on this machine can't leak in.
tools="$root/tools"
stub="$root/stub"
mkdir -p "$tools" "$stub"
for tool in git grep sed tr head cat dirname mktemp; do
  ln -s "$(command -v "$tool")" "$tools/$tool"
done

# Logs each call as one line per argument, closed by END. Behavior comes from STUB_* variables.
cat >"$stub/orca" <<'EOF'
#!/bin/bash
{ for arg in "$@"; do printf '%s\n' "$arg"; done; echo END; } >>"$STUB_LOG"
case "$1 ${2:-}" in
  "status --json")
    [ -z "${STUB_STATUS_FAIL:-}" ] || exit 1
    printf '{\n  "result": {\n    "runtime": {\n      "reachable": %s\n    }\n  }\n}\n' "${STUB_REACHABLE:-true}"
    ;;
  "worktree current")
    case "$PWD" in
      *"${STUB_UNMANAGED:-no such path}"*) exit 1 ;;
    esac
    ;;
  "orchestration worker-start")
    if [ -n "${STUB_START_FAIL:-}" ]; then
      printf '{"result":{"state":"failed","dispatchId":"ctx_1","failedStage":"terminal_create"}}\n'
      exit 1
    fi
    printf '{\n  "result": {\n    "dispatchId": "ctx_1",\n    "state": "ready"\n  }\n}\n'
    ;;
  "orchestration worker-show")
    [ -n "${STUB_NO_HANDLE:-}" ] || printf '{"result":{"worker":{"agentTerminalHandle":"term_1"}}}\n'
    ;;
  "terminal switch")
    [ -z "${STUB_SWITCH_FAIL:-}" ] || exit 1
    ;;
esac
exit 0
EOF
chmod +x "$stub/orca"

pass() { count=$((count + 1)); echo "ok   $1"; }
fail() { count=$((count + 1)); failures=$((failures + 1)); echo "FAIL $1: $2"; }

# Each repo gets a bare origin with one commit, on the default branch given.
new_repo() {
  dir="$root/$1"
  default=${2:-main}
  git init --quiet --bare "$dir/origin.git"
  git -C "$dir/origin.git" symbolic-ref HEAD "refs/heads/$default"
  git init --quiet "$dir/seed"
  git -C "$dir/seed" symbolic-ref HEAD "refs/heads/$default"
  git -C "$dir/seed" -c user.name=t -c user.email=t@t commit --quiet --allow-empty -m one
  git -C "$dir/seed" push --quiet "$dir/origin.git" "$default"
  git clone --quiet "$dir/origin.git" "$dir/main"
  echo "$dir"
}

# Runs the script from a directory; sets out and code.
run_in() {
  from=$1
  shift
  : >"$STUB_LOG"
  out=$(cd "$from" && PATH="$stub:$tools" /bin/bash "$script" "$@" 2>&1)
  code=$?
}

refused() {
  label=$1
  expected=$2
  if [ "$code" -ne 2 ]; then fail "$label" "exit $code, want 2: $out"; return; fi
  case $out in
    *"$expected"*) ;;
    *) fail "$label" "output lacks '$expected': $out"; return ;;
  esac
  if grep -q '^worker-start$' "$STUB_LOG"; then fail "$label" "worker-start ran"; return; fi
  pass "$label"
}

export STUB_LOG="$root/calls.log"
export ORCA_TERMINAL_HANDLE=term_test
brief="$root/brief.md"
printf '# Goal\nFix "quoted" `code` and $HOME\n\nSecond paragraph\n' >"$brief"

repo=$(new_repo a)
main="$repo/main"

# Refusals
: >"$STUB_LOG"
out=$(cd "$main" && PATH="$tools" /bin/bash "$script" check 2>&1); code=$?
refused "refuses when orca is missing" "not on PATH"

STUB_STATUS_FAIL=1; export STUB_STATUS_FAIL
run_in "$main" start task "$brief"
refused "refuses when orca status fails" "unreachable"
unset STUB_STATUS_FAIL

STUB_REACHABLE=false; export STUB_REACHABLE
run_in "$main" start task "$brief"
refused "refuses when the runtime is not reachable" "unreachable"
unset STUB_REACHABLE

unset ORCA_TERMINAL_HANDLE
run_in "$main" start task "$brief"
refused "refuses a session outside an Orca terminal" "not running in an Orca terminal"
export ORCA_TERMINAL_HANDLE=term_test

STUB_UNMANAGED=/a/main; export STUB_UNMANAGED
run_in "$main" start task "$brief"
refused "refuses a repo Orca does not manage" "does not manage"
unset STUB_UNMANAGED

git -C "$main" worktree add --quiet -b linked "$repo/linked"
run_in "$repo/linked" start task "$brief"
refused "refuses in a linked worktree" "linked worktree"

mkdir "$root/plain"
run_in "$root/plain" start task "$brief"
refused "refuses outside a git repository" "not inside a git repository"

noisy=$(new_repo b)
git -C "$noisy/main" remote set-head origin --delete
run_in "$noisy/main" start task "$brief"
refused "refuses without origin/HEAD" "origin/HEAD is not set"

gone=$(new_repo c)
rm -rf "$gone/origin.git"
run_in "$gone/main" start task "$brief"
refused "refuses when the fetch fails" "could not fetch origin/main"

run_in "$main" start "Bad Name" "$brief"
refused "refuses an invalid name" "the name must be"

run_in "$main" start --worktree "$brief"
refused "refuses a name that looks like a flag" "the name must be"

run_in "$main" start task "$root/nope.md"
refused "refuses a missing brief" "missing or empty"

: >"$root/empty.md"
run_in "$main" start task "$root/empty.md"
refused "refuses an empty brief" "missing or empty"

run_in "$main" start task
refused "refuses missing arguments" "usage"

# check
run_in "$main" check
if [ "$code" -eq 0 ] && [ "$out" = "base: origin/main" ] && ! grep -q '^worker-start$' "$STUB_LOG"; then
  pass "check reports the base and starts nothing"
else
  fail "check reports the base and starts nothing" "exit $code: $out"
fi

# Exact flags, and a brief that survives quoting
run_in "$main" start my-task "$brief"
spec=$(cat "$brief")
expected="status
--json
END
worktree
current
--json
END
orchestration
worker-start
--spec
$spec
--worktree
new-top-level
--name
my-task
--base-branch
origin/main
--agent
claude
--json
END
orchestration
worker-show
--dispatch
ctx_1
--json
END
terminal
switch
--terminal
term_1
--json
END"
if [ "$code" -eq 0 ] && [ "$(cat "$STUB_LOG")" = "$expected" ]; then
  pass "passes the exact flags, then reveals the worker's terminal"
else
  fail "passes the exact flags, then reveals the worker's terminal" "exit $code, calls: $(cat "$STUB_LOG")"
fi
case $out in
  *'"dispatchId": "ctx_1"'*'revealed: term_1'*) pass "prints the receipt and the reveal" ;;
  *) fail "prints the receipt and the reveal" "$out" ;;
esac

# Base comes from origin/HEAD, however the default branch is named, from any subdirectory
trunk=$(new_repo d trunk)
mkdir -p "$trunk/main/sub/dir"
run_in "$trunk/main/sub/dir" start my-task "$brief"
if [ "$code" -eq 0 ] && grep -qx 'origin/trunk' "$STUB_LOG"; then
  pass "takes the base from origin/HEAD, from a subdirectory"
else
  fail "takes the base from origin/HEAD, from a subdirectory" "exit $code: $out"
fi

# A task for another repo: that repo's base, named with --repo
run_in "$main" start my-task "$brief" "$trunk/main"
if [ "$code" -eq 0 ] && grep -qx 'origin/trunk' "$STUB_LOG" && grep -qx -- '--repo' "$STUB_LOG" && grep -qx "path:$trunk/main" "$STUB_LOG"; then
  pass "a task for another repo uses that repo's base and --repo"
else
  fail "a task for another repo uses that repo's base and --repo" "exit $code: $(cat "$STUB_LOG")"
fi

git -C "$trunk/main" worktree add --quiet -b linked "$trunk/linked"
run_in "$main" start my-task "$brief" "$trunk/linked"
refused "refuses another repo's linked worktree" "linked worktree"

run_in "$repo/linked" start my-task "$brief" "$trunk/main"
refused "refuses a linked worktree even when the target is another repo" "linked worktree"

STUB_UNMANAGED=/d/main; export STUB_UNMANAGED
run_in "$main" start my-task "$brief" "$trunk/main"
refused "refuses another repo Orca does not manage" "does not manage"
unset STUB_UNMANAGED

run_in "$main" start my-task "$brief" "$root/nope"
refused "refuses a repo path that does not exist" "does not exist"

# The base is fetched before the start
git -C "$repo/seed" -c user.name=t -c user.email=t@t commit --quiet --allow-empty -m two
git -C "$repo/seed" push --quiet "$repo/origin.git" main
run_in "$main" start my-task "$brief"
if [ "$(git -C "$main" rev-parse origin/main)" = "$(git -C "$repo/seed" rev-parse HEAD)" ]; then
  pass "fetches the base before starting"
else
  fail "fetches the base before starting" "origin/main is stale"
fi

# A failed start reports the receipt, does not reveal and does not retry
STUB_START_FAIL=1; export STUB_START_FAIL
run_in "$main" start my-task "$brief"
starts=$(grep -c '^worker-start$' "$STUB_LOG")
case $out in
  *'"failedStage":"terminal_create"'*) shown=1 ;;
  *) shown=0 ;;
esac
if [ "$code" -eq 1 ] && [ "$starts" -eq 1 ] && [ "$shown" -eq 1 ] && ! grep -q '^switch$' "$STUB_LOG"; then
  pass "a failed start prints the receipt, once, without a reveal"
else
  fail "a failed start prints the receipt, once, without a reveal" "exit $code, starts $starts: $out"
fi
unset STUB_START_FAIL

# A failed reveal is reported but the worker keeps running
STUB_SWITCH_FAIL=1; export STUB_SWITCH_FAIL
run_in "$main" start my-task "$brief"
case "$code:$out" in
  0:*"not revealed: orca terminal switch failed for term_1"*) pass "a failed reveal warns and exits 0" ;;
  *) fail "a failed reveal warns and exits 0" "exit $code: $out" ;;
esac
unset STUB_SWITCH_FAIL

STUB_NO_HANDLE=1; export STUB_NO_HANDLE
run_in "$main" start my-task "$brief"
case "$code:$out" in
  0:*"not revealed: dispatch ctx_1 has no agent terminal"*) pass "a worker with no terminal warns and exits 0" ;;
  *) fail "a worker with no terminal warns and exits 0" "exit $code: $out" ;;
esac
unset STUB_NO_HANDLE

echo "$((count - failures))/$count passed"
[ "$failures" -eq 0 ]
