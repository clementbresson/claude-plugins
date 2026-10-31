---
name: backlog
description: Use when you find a bug, debt or improvement you won't fix in the current change, when a step is left that only a person can do (vendor dashboard, production check, monitoring later), when asked to add a todo or ticket, or when asked about priorities or what to do next. Files and works tickets in the repo's docs/todos backlog.
argument-hint: "[set up | add ... | what's next | what's on me | list debt critical | close T-K7M2 | upgrade]"
---

# Backlog

A backlog is one folder in the repo, `docs/todos/`, that holds all its open work, in code or outside it:

- **`TODO.md` is the index.** One line per ticket, under its priority, most urgent first.
- **A ticket is one file**, `T-K7M2-short-slug.md`, with a random id. Its frontmatter holds `type`, `found`, `when` (from
  what moment it can be worked) and `tags`. `human` is the tag for work no PR can close.
- **A block is a project**: one name on the index lines of its tickets, and one goal saying when it is finished. Code
  and human tickets of the same work share a block, and `Land after T-XXXX` orders them.
- **`backlog.sh`** creates tickets, rejects anything off-format, and answers questions across priority, type, block
  and tags.
- **`TODO_RULES.md`** is the full set of rules. This skill only adds what a repo cannot do alone: creating the backlog,
  importing existing lists and upgrading its rules.

The request is: $ARGUMENTS

When you invoked this yourself, the request is your finding. Once it is filed, go back to the work you were doing.

## 1. Route

From the repo root, find the state, then take the row that matches the state and the request.

| State | Request | Do |
|---|---|---|
| No `docs/todos/`, but the repo keeps todo lists in its own files | set up or migrate | Bootstrap, then Import, then hand over |
| No `docs/todos/`, but the repo keeps todo lists in its own files | anything else | Follow the repo's own lists and instructions, and stop here |
| No `docs/todos/` | set up | Bootstrap, then hand over |
| No `docs/todos/` | add a ticket | Bootstrap, then step 3, then hand over |
| No `docs/todos/` | a finding of your own | Create nothing. Name the finding in your final reply, and that `/clementbresson:backlog set up` starts a backlog |
| No `docs/todos/` | anything else | Say there is no backlog, and stop |
| `docs/todos/` without `backlog.sh` | set up | Migrate, then hand over |
| `docs/todos/` without `backlog.sh` | anything else | Follow the rules already there, and say in one line that it is not migrated |
| `backlog.sh` present | upgrade | Upgrade, then hand over |
| `backlog.sh` present | anything else | Step 3, then hand over |

## 2. Change the repo

**Bootstrap.** Copy `${CLAUDE_SKILL_DIR}/template/TODO.md`, `TODO_RULES.md`, `TEMPLATE.md` and `backlog.sh` to `docs/todos/`, then
add the pointer.

**Migrate** brings a `docs/todos/` that already holds one file per ticket to this format.
1. Keep every ticket and id, and all local rule wording that still applies.
2. Merge the template's sections into the existing rules.
3. Copy `backlog.sh` and `TEMPLATE.md`, and make `TODO.md` follow the template, adding `## Blocks` last.
4. Move a priority written in a ticket to its index line. When the two disagree, the index wins, and the hand-over names
   the disagreement.
5. Give each ticket the template's frontmatter, its H1 at line 8, and its three headings.
6. Create a block for each set of tickets that clearly serves one big thing, following the rules' Blocks section.
7. Add or update the pointer.

**Import** turns free-form lists into tickets, following the rules' Adding a ticket, When, Human tickets and Blocks
sections. Skip its search and fix-or-ticket steps. Lists keep changing while this runs, so go one section at a time:

1. Name the lists and their sections in your reply. Take the lists the user named, plus those the repo's instructions
   treat as live. Before the first section, change those instructions so new items go to the backlog, and head each
   old list with one line saying it is being emptied into `docs/todos/`.
2. For the next section, read it in full and account for every item: a ticket, part of a ticket, a line in a doc, or
   a deletion. A deletion needs the proof that it is done, or the user's word. When unsure, keep it as a ticket whose
   Fix says `Unknown: first find X.` Items that say the same thing across lists become one ticket.
3. An initiative with an end state becomes a block. Triggers become `when`, and a section's date becomes `found`, or the date `git log` gives when it has none.
   Mentions of work elsewhere become `Land after`; one whose ticket does not exist yet stays as words in the Fix until
   its section is imported. Docs live outside `docs/todos/`. A level the list states stays, unless its evidence shows
   the harm is over. Otherwise the rules' table decides, and the list's order ranks inside a level.
4. Remove the section from the old list in the same commit as its tickets, so an import stopped halfway leaves
   everything in exactly one place.
5. When a list holds no item, delete it. `git grep` its name and repoint every mention. Move the repo's own rules about that
   list into `TODO_RULES.md`, keeping what is specific to the repo.
6. After the last section, rank each priority level by urgency, since tickets arrive in import order.

**Upgrade.** Diff the repo's `TODO_RULES.md` against the template, merge new rules by hand keeping local edits, and
replace `backlog.sh` and `TEMPLATE.md`. Give tickets from before `when` and `tags` existed the defaults with
`perl -0pi -e 's/\A(---\ntype: .*\nfound: .*\n)---\n/$1when: now\ntags: []\n---\n/' docs/todos/T-*.md`, then correct the ones
that wait for something or need a tag. Other tickets `check` rejects get the new format by hand.

**Pointer.** Put it in whichever of CLAUDE.md or AGENTS.md holds the repo's real instructions. If CLAUDE.md only
imports AGENTS.md, use AGENTS.md. If neither exists, create CLAUDE.md. The text, without the quote marks, as a bullet
if the file is a list:

> **Backlog** (todos, tickets, blocks): read and follow `docs/todos/TODO_RULES.md` when you find an issue, debt or
> improvement, or leave a step only a person can do; when asked about todos, priorities, grouping or what to do next; when starting or finishing a ticket;
> when a merge or rebase touches `docs/todos/`.

Done when the files and pointer exist, `sh docs/todos/backlog.sh check` prints nothing, and an import has accounted for
every item of the sections it covered.

## 3. Do the request

Read `docs/todos/TODO_RULES.md` in full and follow the section matching the request. A question that slices the backlog
("critical debt", "what's left on feature-x for a person") is answered with `backlog.sh list`. With no request, report the
tickets per priority, the output of `sh docs/todos/backlog.sh blocks` and `human`, and the result of the rules'
"What's next".

Done when that section's "Done when" holds, if it has one, and `sh docs/todos/backlog.sh check` prints nothing.

## 4. Hand over

One line per ticket touched (ref, priority, block or "no block", and its tags), or one line for a bulk change; each block created;
any file created outside `docs/todos/`; and the commit message when you did not commit. After a bootstrap or
migration, add that a team can run `sh docs/todos/backlog.sh check` in CI.
