#!/bin/sh
# Fails when a skill under plugins/ names a specific machine or project. Prints one file:line per hit, and exits 1.
#
# Two layers, because this repo is public and a committed list of private names would publish them:
# - Machine patterns, below. These also run in CI.
# - Private names: one per line in agnostic-denylist inside the git common dir, so every worktree shares it and it is
#   never pushed. Matching ignores case. Blank lines and lines starting with # are skipped. The local git user.email
#   is always included.
#
# Usage: sh scripts/check-agnostic.sh
cd "$(git rev-parse --show-toplevel)" || exit 2

machine='/Users/[A-Za-z0-9]|/home/[A-Za-z0-9]|[A-Za-z]:\\Users\\|/private/(tmp|var)/|/opt/homebrew|/tmp/claude-'

check() {
  git grep --untracked -n -I -E -e "$machine" -- plugins

  denylist="$(git rev-parse --git-common-dir)/agnostic-denylist"
  {
    git config user.email
    [ -f "$denylist" ] && grep -vE '^[[:space:]]*(#|$)' "$denylist"
  } | while IFS= read -r name; do
    git grep --untracked -n -I -i -F -e "$name" -- plugins
  done
}

! check | grep .
