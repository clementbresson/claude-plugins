#!/bin/bash
# Starts one supervised Orca worker in a new worktree, then reveals it in the app.
# Run from the repo's main checkout, with an orchestration Run already bound.
#
# Usage: start-task.sh check [REPO_PATH]
#        start-task.sh start NAME BRIEF_FILE [REPO_PATH]
#
# REPO_PATH names the main checkout of another repo when the task belongs there.
#
# Exit codes: 0 ok, 1 worker-start did not reach ready, 2 refused.
# Needs bash 3.2, git and orca; no jq, since not every machine has it.
set -u

refuse() {
  echo "orca-new-task refused: $1" >&2
  exit 2
}

# First value of a string field in JSON, compact or pretty-printed.
json_string() {
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -n 1 | sed 's/.*:[[:space:]]*"//; s/"$//'
}

check_orca() {
  command -v orca >/dev/null 2>&1 || refuse "the orca CLI is not on PATH."
  status=$(orca status --json 2>/dev/null) || refuse "Orca is unreachable: orca status failed. Start it with: orca open"
  printf '%s' "$status" | tr -d '[:space:]' | grep -q '"reachable":true' ||
    refuse "Orca is unreachable: its runtime reports not reachable. Start it with: orca open"
  # Outside an Orca terminal the CLI guesses its caller, and could read another pane's messages.
  [ -n "${ORCA_TERMINAL_HANDLE:-}" ] || refuse "this session is not running in an Orca terminal. This skill only works inside Orca."
}

check_managed() {
  orca worktree current --json >/dev/null 2>&1 || refuse "Orca does not manage this repo. Add it with: orca repo add --path <repo>"
}

check_main_checkout() {
  git_dir=$(git rev-parse --git-dir 2>/dev/null) || refuse "not inside a git repository."
  common_dir=$(git rev-parse --git-common-dir) || refuse "git rev-parse --git-common-dir failed."
  git_dir=$(cd "$git_dir" && pwd -P) || refuse "cannot read the git directory."
  common_dir=$(cd "$common_dir" && pwd -P) || refuse "cannot read the git common directory."
  [ "$git_dir" = "$common_dir" ] || refuse "this is a linked worktree. Start tasks from the repo's main checkout."
}

# Sets base to origin/<default> and refreshes it, so a worker never starts from a stale branch.
fetch_base() {
  base=$(git -C "${repo:-.}" symbolic-ref --quiet --short refs/remotes/origin/HEAD) ||
    refuse "origin/HEAD is not set, so the default branch is unknown. Set it with: git remote set-head origin --auto"
  git -C "${repo:-.}" fetch --quiet origin "${base#origin/}" || refuse "could not fetch $base."
}

# Sets repo to the target's absolute path, empty when the task belongs to this repo.
preflight() {
  repo=$1
  check_orca
  check_main_checkout
  check_managed
  if [ -n "$repo" ]; then
    repo=$(cd "$repo" 2>/dev/null && pwd -P) || refuse "the repo path $1 does not exist."
    (cd "$repo" && check_main_checkout && check_managed) || exit 2
  fi
  fetch_base
}

# A failed reveal is reported, not fatal: the worker is already running.
reveal() {
  dispatch=$(printf '%s' "$1" | json_string dispatchId)
  [ -n "$dispatch" ] || { echo "not revealed: the receipt names no dispatchId." >&2; return; }
  handle=$(orca orchestration worker-show --dispatch "$dispatch" --json 2>/dev/null | json_string agentTerminalHandle)
  [ -n "$handle" ] || { echo "not revealed: dispatch $dispatch has no agent terminal." >&2; return; }
  if orca terminal switch --terminal "$handle" --json >/dev/null 2>&1; then
    echo "revealed: $handle" >&2
  else
    echo "not revealed: orca terminal switch failed for $handle." >&2
  fi
}

start() {
  name=$1
  brief_file=$2
  case $name in
    ''|-*|*[!a-z0-9-]*) refuse "the name must be lowercase letters, digits and hyphens." ;;
  esac
  [ -s "$brief_file" ] || refuse "the brief $brief_file is missing or empty."
  preflight "$3"

  receipt=$(orca orchestration worker-start --spec "$(cat "$brief_file")" \
    --worktree new-top-level --name "$name" ${repo:+--repo "path:$repo"} \
    --base-branch "$base" --agent claude --json)
  code=$?
  printf '%s\n' "$receipt"
  # Never relaunch here: the receipt names what exists and how to recover.
  [ "$code" -eq 0 ] || exit 1
  reveal "$receipt"
}

case ${1:-} in
  check)
    [ "$#" -le 2 ] || refuse "usage: start-task.sh check [REPO_PATH]"
    preflight "${2:-}"
    echo "base: $base"
    ;;
  start)
    [ "$#" -eq 3 ] || [ "$#" -eq 4 ] || refuse "usage: start-task.sh start NAME BRIEF_FILE [REPO_PATH]"
    start "$2" "$3" "${4:-}"
    ;;
  *)
    refuse "usage: start-task.sh check [REPO_PATH] | start-task.sh start NAME BRIEF_FILE [REPO_PATH]"
    ;;
esac
