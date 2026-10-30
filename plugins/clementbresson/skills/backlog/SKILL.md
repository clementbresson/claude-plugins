---
name: backlog
description: Set up or work a repo-local backlog in docs/todos, a priority index plus one file per ticket, with blocks for related work.
disable-model-invocation: true
argument-hint: "[set up | add ... | what's next | close T-K7M2 | upgrade]"
---

# Backlog

A backlog is `docs/todos/`, and its rules live in the repo, in `docs/todos/TODO_RULES.md`. This skill only adds what
a repo cannot do alone: creating the backlog and upgrading its rules.

The request is: $ARGUMENTS

## 1. Route

From the repo root, find the state, then take the row that matches the state and the request.

| State | Request | Do |
|---|---|---|
| No `docs/todos/` | set up | Bootstrap, then hand over |
| No `docs/todos/` | add a ticket | Bootstrap, then step 3, then hand over |
| No `docs/todos/` | anything else | Say there is no backlog, and stop |
| `docs/todos/` without `backlog.sh` | set up | Migrate, then hand over |
| `docs/todos/` without `backlog.sh` | anything else | Follow the rules already there, and say in one line that it is not migrated |
| `backlog.sh` present | upgrade | Upgrade, then hand over |
| `backlog.sh` present | anything else | Step 3, then hand over |

## 2. Change the repo

**Bootstrap.** Copy `${CLAUDE_SKILL_DIR}/template/TODO.md`, `TODO_RULES.md` and `backlog.sh` to `docs/todos/`, then
add the pointer.

**Migrate.**
1. Keep every ticket and id, and all local rule wording that still applies.
2. Merge the template's sections into the existing rules.
3. Copy `backlog.sh`, and make `TODO.md` follow the template, adding `## Blocks` last.
4. Compare each `**Priority:**` field with its ticket's index section, and name any disagreement in the hand-over.
   The index wins.
5. Remove the fields: `perl -pi -e 's/^\*\*Priority:\*\* \w+ · //' docs/todos/T-*.md`.
6. Create a block for each set of tickets that clearly serves one big thing, following the rules' Blocks section.
7. Add or update the pointer.

**Upgrade.** Diff the repo's `TODO_RULES.md` against the template, merge new rules by hand keeping local edits, and
replace `backlog.sh`.

**Pointer.** Put it in whichever of CLAUDE.md or AGENTS.md holds the repo's real instructions. If CLAUDE.md only
imports AGENTS.md, use AGENTS.md. If neither exists, create CLAUDE.md. The text, without the quote marks, as a bullet
if the file is a list:

> **Backlog** (todos, tickets, blocks): read and follow `docs/todos/TODO_RULES.md` when you find an issue, debt or
> improvement; when asked about todos, priorities, grouping or what to do next; when starting or finishing a ticket;
> when a merge or rebase touches `docs/todos/`.

Done when the files and pointer exist and `sh docs/todos/backlog.sh check` prints nothing.

## 3. Do the request

Read `docs/todos/TODO_RULES.md` in full and follow the section matching the request. With no request, report the
tickets per priority, the output of `sh docs/todos/backlog.sh blocks`, and the result of the rules' "What's next".

Done when that section's "Done when" holds, if it has one, and `sh docs/todos/backlog.sh check` prints nothing.

## 4. Hand over

One line per ticket touched (ref, priority, block or "no block"), or one line for a bulk change; each block created;
any file created outside `docs/todos/`; and the commit message when you did not commit. After a bootstrap or
migration, add that a team can run `sh docs/todos/backlog.sh check` in CI.
