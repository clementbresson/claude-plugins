# Backlog rules

The backlog lives in `docs/todos/`. `TODO.md` is the index and the only place that holds a ticket's priority,
rank and block. Everything else about a ticket is in its own frontmatter. Each ticket is one file next to it, named `T-XXXX-short-slug.md`; older numeric ids (`T-018`) stay
valid. Run commands from the repo root.

## Every time

- **Check.** Run `sh docs/todos/backlog.sh check` before and after any change here, and after any merge or rebase
  that touches this folder. Repair what it prints before anything else, including problems you did not cause. It
  prints one line per problem with its repair and exits 1. Silence means the index is well formed, not that the
  work is right. A team can add this one command to CI.
- **Refs.** Turn the user's words into an explicit list of refs before writing, and print the list in your reply.
  "That one" is the ticket last named in the conversation. A topic ("the billing stuff") is every index line
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
   it becomes a ticket. A step only a person can do always becomes one, never just a line in your report. An explicit
   request to add a ticket skips this step.
2. **Search first.** Run `git fetch --prune`. `grep -ril` the key words (file, model, record id)
   in `docs/todos/`, and run `git grep -il WORD $(git branch -r --format='%(refname:short)') -- docs/todos`. When
   a ticket here covers it, add the new evidence to that ticket. When one on another branch covers it, tell the
   user and file nothing.
3. **Cut it atomic.** One ticket is one fix that merges alone, in any order relative to every other ticket: a data
   fix, a validation and a refactor are three tickets. Two changes that only work together are one ticket, and
   the ticket says why. A large ticket is allowed only when no smaller step ships safely on its own, and the
   ticket says why. When one ticket should land first, the one that waits opens its Fix with
   `Land after T-XXXX: why.` Work done gradually, as files get touched, is one ticket whose Done when names the end
   state. Human tickets are cut differently: see Human tickets.
4. **Create the file** with `sh docs/todos/backlog.sh new short-slug`. With no shell, copy `TEMPLATE.md` to
   `T-XXXX-short-slug.md`, picking 4 characters from `23456789ABCDEFGHJKMNPQRSTVWXYZ`, at least one a letter, that no
   file in the folder has.
5. **Fill in every part.** Keep the structure exact: one `type` value, one `when` value, `tags` with `human` when no
   PR can close it, and every heading as it stands. Spend one quick pass locating the code. When the fix is not known, Fix says `Unknown: first find X.`
6. **List it** in `TODO.md` under its priority, at its place by urgency, comparing index sentences only. Read
   `## Blocks` and tag the line when it fits one. End the sentence with a full stop.

Done when every finding has exactly one ticket, and your reply names each new ticket's priority, with why, and its
block or "no block".

## Priorities

| Priority | Meaning |
|---|---|
| CRITICAL | Harm happening now: data loss, site or revenue down, an exploitable security hole. Drop other work. |
| HIGH | Visitors or users affected now, or a likely security risk. Next in line. |
| MODERATE | Wrong behaviour with limited impact, or debt that slows planned work. |
| LOW | Cleanup, consistency, rare edge cases. |

Between two levels, take the lower one. Higher in a section means more urgent. Rank by the harm of not doing it; a
date goes in `when`. Judge a step that prepares a launch by the harm if the launch happened without it.

To change a priority, move the line and give the reason in the commit message. A user's urgency call wins over the
table. Each named ticket goes to the level the user names, or one level in the direction they say, and to the top
of that section; tickets landing in one section keep their index order. Only a user saying "critical" puts a ticket
in CRITICAL: "more urgent" stops at the top of HIGH.

## When

Every ticket says in `when` from what moment it can be worked. An order between two tickets is a `Land after`, not a
`when`.

| `when` | Meaning |
|---|---|
| `now` | Nothing to wait for. |
| `from 2027-01-27` | Not before that date. |
| `by 2027-09-01` | Workable now, and it must be finished by that date. |
| `after the release is in production` | Once a condition holds. |
| `before the release reaches production` | Workable now, and it must be finished before that event. |

Write a condition so anyone can check it, in the words you were given: "a few days after launch" stays that, with no
invented number.

## Tags

`tags` in the frontmatter is a free list of kebab words, for any way of slicing the backlog that is not a priority, a
type or a block. `human` is the one the rules act on. Run `sh docs/todos/backlog.sh tags` and reuse a word before adding
one.

`sh docs/todos/backlog.sh list TERM...` shows the tickets matching every term, where a term is a priority, a type, a
block, a tag, or `none` for no block:

- `list debt critical high`: urgent technical debt.
- `list feature-x human`: what is left for a person on that feature.

## Human tickets

A ticket is human when no PR can close it: a vendor dashboard or console, production config, a check on real data or a
real device, a decision, watching something days later. It carries the `human` tag. A person writing a PR is not human
work, and neither is their review of it, which is a Done when of that PR's ticket. An agent may do part of a human ticket when its tools allow and the user asks.

- **One backlog.** The code half and the human half of the same work are separate tickets in the same block, and
  `Land after` orders them in either direction. A code ticket waiting on a person's decision lands after that decision's
  ticket.
- **Cut.** One human ticket is the steps one person does in one sitting, at one trigger. A later trigger is another
  ticket that lands after it. Staging checks and production checks are two tickets, and so are
  decisions that unblock different tickets.
- **Fix** holds the steps, each usable without the conversation: the exact command or console path, ready to paste, with
  real names and no placeholder. A value nobody has yet is named as the step that gets it. Never a secret value. Vendor
  behaviour comes from its docs or SDK, not from memory.
- **Repeating check.** "Weekly until March" is one ticket. After each pass, move `when` to the next date; a `when`
  still ahead stays as it is. Done when names the end.
- **Not a ticket.** What can never be closed: a standing rule ("never enable X"), a procedure repeated at each event,
  facts kept for reference. What ends with the block goes in the doc linked from its line; what outlives the block goes
  in the repo's instructions, or a doc they point to.
- **See them.** `sh docs/todos/backlog.sh human` splits them into what a person can do now, what depends on a condition
  they must check, and what is waiting.

## Blocks

A block groups the tickets of one big thing, code and human alike: a feature, a migration, an audit's follow-ups. It is a kebab name and a goal: the end state that says the block is
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
- **No block** is the normal state of unrelated debt. A block needs a goal that can be reached, so there is no
  catch-all block: `type: debt` and `list debt` already slice it.
- **See the blocks:** `sh docs/todos/backlog.sh blocks` prints each goal with its tickets, in index order.
  `blocks NAME` shows one block.

## What's next

This section only reads: no branch, no push. It finds the next ticket an agent can work. When a person asks what they
have to do, run `sh docs/todos/backlog.sh human` and report that instead.

1. Run `git fetch --prune` and read `git show origin/HEAD:docs/todos/TODO.md`. When that fails (no remote, or the
   backlog is not pushed yet), read the working tree instead.
2. Walk the ticket lines from the top. For each, read the ticket's Fix from the same source, plus its
   block's goal and any linked doc.
   - **Needs a person:** the ticket is tagged `human`, or the Fix names a decision or step only a person can take and does
     not record it as done. Count it and go on.
   - **Not yet:** `when` is a future date, or an `after` condition you cannot show true. Note it and go on.
   - **Must wait:** the Fix says `Land after` an open ticket, or the block's doc puts an open ticket first. Go to
     that ticket, then come back. When that ticket fails one of these tests, note both and go on.
   - **Claimed:** ``git branch -r -i --list '*T-XXXX*' --format='%(committerdate:short) %(refname:short)'`` shows
     a commit in the last 14 days. Note it and go on. An older hit is stale: note it, and the ticket is free.
3. Report the first ticket that passes, and every line above it with its reason. Human lines above it are one line
   with their count and `sh docs/todos/backlog.sh human`, plus each one the reported ticket's block is waiting on.

Done when the report names one ticket, or says none is free, and accounts for every line above it.

## Starting a ticket

Run this only when asked to start or work on a ticket.

1. **Choose.** Take the named ticket, or the result of What's next. Read its H1 and Fix. If it must wait or is
   claimed, say so before going on. A hit on your own current branch means resume.
2. **Branch** from the fetched default branch, as `<user>/T-XXXX-short-slug`. The ref in the branch name is the claim.
3. **Push** at the first commit when you are allowed to. Otherwise tell the user the ticket is unclaimed.

To abandon a ticket, delete the branch. When a person takes a decision, record it in the Fix.

A human ticket has no branch and no claim. Walk the person through its Fix, and remove each step from it as it is done.

Done when the ref is on a pushed branch, or the user knows it is not. For a human ticket, when the person has its steps.

## Closing

1. **Verify.** Run every Done when condition of the ticket. One that cannot be shown true keeps the ticket open;
   report which one. Skip this only for an obsolete ticket. On a human ticket, the person's word is enough for what you
   cannot observe yourself, and the commit message says so.
2. **Delete** the file and its line in `TODO.md`, in the change that fixes it. The commit subject is
   `Close T-XXXX: short title`. A fix already merged cites its commit in the message, when one exists. An obsolete ticket gives the
   reason. Before deleting a human ticket, copy what the person decided or found into the Fix of each ticket landing
   after it, and remove the `Land after` there.
3. **Mentions.** Run `git grep -n T-XXXX`. Update what says the work is still pending and links to the deleted
   file. A statement that is still true stays as written.
4. **Last ticket of a block:** check the goal. If it holds, delete the block's line, after moving out anything in its
   doc that outlives it. If it fails, cut a ticket for what is missing, in the same block.

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
