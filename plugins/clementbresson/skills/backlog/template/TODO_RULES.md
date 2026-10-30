# Backlog rules

The backlog lives in `docs/todos/`. `TODO.md` is the index and the only place that holds a ticket's priority,
rank and block. Each ticket is one file next to it, named `T-XXXX-short-slug.md`; older numeric ids (`T-018`) stay
valid. Run commands from the repo root.

## Every time

- **Check.** Run `sh docs/todos/backlog.sh check` before and after any change here, and after any merge or rebase
  that touches this folder. Repair what it prints before anything else, including problems you did not cause. It
  prints one line per problem with its repair and exits 1. Silence means the index is well formed, not that the
  work is right. A team can add this one command to CI.
- **Refs.** Turn the user's words into an explicit list of refs before writing, and print the list in your reply.
  "That one" is the ticket last named in the conversation. A topic ("the Swiss Life stuff") is every index line
  whose sentence or block name contains it: act on those, and name any block-mates left out. List candidates and
  stop only when nothing matches.
- **Resolve.** `find docs/todos -maxdepth 1 -iname 'T-XXXX-*'`, then read the H1 and confirm it is the expected
  problem.
- **Cite** tickets by id and write each id out, not as a range.
- **Commits.** A ticket found during a change ships in that change's PR. A standalone request stays local until
  the user asks for a commit; say so. When you are not committing, print the commit message: `Add T-XXXX: short
  title`, `Close T-XXXX: short title`, or one line saying what changed.

## Adding a ticket

When you find an issue, debt or improvement, or are asked to add a ticket:

1. **Fix or ticket.** Fix it in the current change only when it is small and inside the change's scope. Otherwise
   it becomes a ticket. An explicit request to add a ticket skips this step.
2. **Search first.** Run `git fetch --prune`. Read `TODO.md`, `grep -ril` the key words (file, model, record id)
   in `docs/todos/`, and run `git grep -il WORD $(git branch -r --format='%(refname:short)') -- docs/todos`. When
   a ticket here covers it, add the new evidence to that ticket. When one on another branch covers it, tell the
   user and file nothing.
3. **Cut it atomic.** One ticket is one fix that merges alone, in any order relative to every other ticket: a data
   fix, a validation and a refactor are three tickets. Two changes that only work together are one ticket, and
   the ticket says why. A large ticket is allowed only when no smaller step ships safely on its own, and the
   ticket says why. When one ticket should land first, the one that waits opens its Fix with
   `Land after T-XXXX: why.`
4. **Get the id** with `sh docs/todos/backlog.sh id`. With no shell, pick 4 characters from
   `23456789ABCDEFGHJKMNPQRSTVWXYZ`, at least one a letter, and confirm no file in the folder has them.
5. **Write the ticket** from the template. Spend one quick pass locating the code. When the fix is not known, Fix
   says `Unknown: first find X.`
6. **List it** in `TODO.md` under its priority, at its place by urgency, comparing index sentences only. Read
   `## Blocks` and tag the line when it fits one.

Done when every finding has exactly one ticket, and your reply names each new ticket's priority, with why, and its
block or "no block".

## Priorities

| Priority | Meaning |
|---|---|
| CRITICAL | Harm happening now: data loss, site or revenue down, an exploitable security hole. Drop other work. |
| HIGH | Visitors or users affected now, or a likely security risk. Next in line. |
| MODERATE | Wrong behaviour with limited impact, or debt that slows planned work. |
| LOW | Cleanup, consistency, rare edge cases. |

Between two levels, take the lower one. Higher in a section means more urgent.

To change a priority, move the line and give the reason in the commit message. A user's urgency call wins over the
table. Each named ticket goes to the level the user names, or one level in the direction they say, and to the top
of that section; tickets landing in one section keep their index order. Only a user saying "critical" puts a ticket
in CRITICAL: "more urgent" stops at the top of HIGH.

## Template

```markdown
# T-XXXX The problem, stated as a sentence

**Type:** bug | security | data | debt | improvement · **Found:** YYYY-MM-DD

## Problem

What is wrong, where (`path:line`, record ids), and the evidence (query, spec, log).

## Fix

The one change that closes it. Name the decision to take first when there is one.

## Done when

- [ ] A condition anyone can check.
```

## Blocks

A block groups the tickets of one big thing. It is a kebab name and a goal: the end state that says the block is
finished. A ticket joins when working the goal without it would lose context or order, and it is in one block at
most. If two fit, take the one whose goal it most directly closes, and state the other link as a `Land after`
sentence. These are judgment calls, and each costs one tag to change.

- **Create or join:** read `## Blocks` and reuse a name that fits. A new block is one line, ``- `name` — Goal.``,
  and each member's line carries the name in backticks right after its link.
- **On request:** "group these" wins. Write the goal as an end state, and if you cannot, ask for that one sentence.
  A ticket already in a block moves to the new one; say so in your reply.
- **Rank:** tagging moves no line. When inserting between tickets of equal urgency, sit next to block-mates.
- **Priority** stays per ticket. A block has none.
- **Shared context:** a block's line may end in `[doc](path)`, relative to `docs/todos/`, pointing at a doc that
  already holds it. Any order that doc gives applies to its open tickets.
- **See the blocks:** `sh docs/todos/backlog.sh blocks` prints each goal with its tickets, in index order.

## What's next

This section only reads: no branch, no push.

1. Run `git fetch --prune` and read `git show origin/HEAD:docs/todos/TODO.md`. When that fails (no remote, or the
   backlog is not pushed yet), read the working tree instead.
2. Walk the ticket lines from the top. For each, read the ticket's Fix from the same source, plus its
   block's goal and any linked doc.
   - **Needs a person:** the Fix names a decision or step only a person can take, and does not record it as done.
     Note it and go on.
   - **Must wait:** the Fix says `Land after` an open ticket, or the block's doc puts an open ticket first. Go to
     that ticket, then come back.
   - **Claimed:** ``git branch -r -i --list '*T-XXXX*' --format='%(committerdate:short) %(refname:short)'`` shows
     a commit in the last 14 days. Note it and go on. An older hit is stale: note it, and the ticket is free.
3. Report the first ticket that passes, and every line above it with its reason.

Done when the report names one ticket, or says none is free, and accounts for every line above it.

## Starting a ticket

Run this only when asked to start or work on a ticket.

1. **Choose.** Take the named ticket, or the result of What's next. Read its H1 and Fix. If it must wait or is
   claimed, say so before going on. A hit on your own current branch means resume.
2. **Branch** from the fetched default branch, as `<user>/T-XXXX-short-slug`. The ref in the branch name is the claim.
3. **Push** at the first commit when you are allowed to. Otherwise tell the user the ticket is unclaimed.

To abandon a ticket, delete the branch. When a person takes a decision, record it in the Fix.

Done when the ref is on a pushed branch, or the user knows it is not.

## Closing

1. **Verify.** Run every Done when condition of the ticket. One that cannot be shown true keeps the ticket open;
   report which one. Skip this only for an obsolete ticket.
2. **Delete** the file and its line in `TODO.md`, in the change that fixes it. The commit subject is
   `Close T-XXXX: short title`. A fix already merged cites its commit in the message, when one exists. An obsolete ticket gives the
   reason.
3. **Mentions.** Run `git grep -n T-XXXX`. Update what says the work is still pending and links to the deleted
   file. A statement that is still true stays as written.
4. **Last ticket of a block:** check the goal. If it holds, delete the block's line. If it fails, cut a ticket for
   what is missing, in the same block.

To recover a closed ticket: `git log --diff-filter=D -- 'docs/todos/T-XXXX*'`, then `git show <sha>^:<path>`.

Done when each Done when condition has been shown true, or the reason for skipping is in the commit message.

## Merge conflicts

- **In `TODO.md`:** keep every line added on either side and drop every line whose file is gone. `merge=union` stays
  off, because it silently brings closed tickets back.
- **Two versions of one ticket's line** become one line: position from the side that moved it, text and tag from
  the side that edited it. When both moved it, take the higher one and say so in the merge commit.
- **A ticket edited here and deleted there:** the close wins. If your evidence still matters, cut a new ticket.
- **Two files with one id:** the one added second gets a new id, in its filename, H1, index line and mentions.
  `git log --diff-filter=A --format='%h %ad' -- 'docs/todos/T-XXXX-*'` shows the order.

Done when no conflict markers remain and every ticket has one line.
