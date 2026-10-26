---
name: branch-tour
description: Walk through everything a finished branch changed, as an interactive artifact page grouped in reading order with a seen checkbox per file.
disable-model-invocation: true
argument-hint: "[base branch]"
---

# Branch tour

Build a page that walks through every change on the current branch the way a
colleague would walk through a PR: in the order that makes the change easy to
understand, one explained step at a time, with every file's diff and a *Seen*
checkbox on each.

The page is always the same template. The diff on it comes straight from git
through `scripts/tour.py`. You write one thing: the tour JSON, which orders,
groups and explains.

`$ARGUMENTS` is an optional base branch. Without it the script uses
`origin/HEAD`, then `main`, then `master`.

## Step 1 — Collect

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/tour.py files --base BASE   # omit --base when no argument
```

It prints the branch, the merge base, `previous tour URL` when this branch
already has a page, and one line per changed file: status, `+`/`-` counts,
path, and tags such as `lockfile`, `generated`, `binary`, `untracked`. The
comparison runs from the merge base to the working tree, so uncommitted and
untracked files are part of it.

Done when you have the file list and the merge base hash.

## Step 2 — Read every change

Read the full diff: `git diff MERGE_BASE`, and the contents of each untracked
file. On a large branch read it a few files at a time with
`git diff MERGE_BASE -- PATH`. Open surrounding code when a hunk only makes
sense with its context.

Files tagged `lockfile` or `generated` need only their stats. Every other file
is read, because a group can only be explained by someone who has seen what
is in it.

Done when every untagged file's diff has been read.

## Step 3 — Write the tour

Write the tour JSON in the session scratchpad, at
`branch-tour/<branch>.json` with `/` in the branch name replaced by `-`.

```json
{
  "version": 1,
  "title": "Invoice reminder emails",
  "summary": "What the branch does and why, in 2 to 4 sentences.",
  "groups": [
    {
      "title": "The reminder schedule as a domain type",
      "role": "main",
      "description": "What this step changes, why, and how it connects to the previous step.",
      "files": [
        { "path": "src/billing/reminder.ts", "note": "New `ReminderSchedule` value object." },
        {
          "path": "src/billing/send-reminders.ts",
          "focus": [
            { "start": 40, "end": 62, "side": "new", "note": "Why the retry window is computed from the due date, not from now." }
          ]
        }
      ]
    }
  ]
}
```

**Order: foundations first.** Lead with what the rest is built on, then
follow the flow of the change: types and schema, then domain logic, then use
cases, then wiring (API, jobs, DI), then UI. A test goes in the group of the
code it tests, right after that code. Inside a group, a file comes after the
files it depends on. Changes unrelated to the main story come after it as
their own groups, with `"role": "side"`. Lockfiles, generated output, config
bumps and formatting-only files close the tour in `"role": "chore"` groups.
Everything else is `"role": "main"` (the default).

**Group by intent.** A group is one step of the story: a set of files that
only make sense together. Split a step that carries two ideas, and merge
steps too thin to explain alone.

**Write as the colleague walking through it.** `summary` gives the whole
branch in a few sentences: the problem, the approach, anything surprising.
Each `description` says what the step changes, why it was needed, and how it
links to the step before, with concrete names in backticks. Explain the code;
the page is a walkthrough, so flag nothing as a bug. Separate paragraphs with
a blank line; `code` and `**bold**` are the only markup.

**`note`** is an optional one-liner shown in the file header: what this file
contributes to its group. When most of a file's diff is re-indentation, say
so: the page's **Hide whitespace** toggle shows only the real change.

**`focus`** marks a hard region inside a diff with a margin note. Use it for
logic a reader would otherwise have to stop and decode: a tricky algorithm, a
subtle ordering, a non-obvious edge case. `start` and `end` are line numbers
on the `side` of the diff, `new` for added or kept lines, `old` for deleted
ones, and must fall inside a hunk. Most files need no focus.

**`title`** names the branch's work as a short noun phrase of two to four
words. It becomes the artifact's name.

Done when every changed file appears in exactly one group.

## Step 4 — Build

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/tour.py build --base BASE \
  --tour SCRATCHPAD/branch-tour/<branch>.json --out SCRATCHPAD/branch-tour/<branch>.html
```

`build` rejects the tour when a changed file is missing or listed twice, a
path is not a changed file, a field is empty, or a focus range is outside the
diff. It prints every problem at once; fix the JSON and build again.

Done when it prints `Wrote …`.

## Step 5 — Publish

Publish the page with the Artifact tool:

- `file_path`: the built `.html`
- `capabilities`: `{"db": {}}`, which keeps the seen marks with the tour
- `description`: one sentence, e.g. "Walkthrough of the 23 files changed on
  feat/invoice-reminders, in reading order."
- `icon`: `code` on a first publish

When step 1 printed a `previous tour URL`, update that artifact instead: read
it first (`action: "read"`, `url`), then publish with that `url` and without
`icon`. Seen marks carry over for every file whose diff has not changed;
files that changed since start unseen again.

After a first publish, remember the URL so the next run updates the same page:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/tour.py remember URL
```

## Step 6 — Hand over

Reply with the link, the group titles in order, and one line per side or
chore group saying why it sits outside the main story.
