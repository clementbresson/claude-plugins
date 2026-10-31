# claude-plugins

Claude Code skills I use across projects, shipped as one plugin, `clementbresson`,
so every skill is called as `/clementbresson:<skill>`.

| Skill | What it does |
|---|---|
| [`/clementbresson:pr-review`](#pr-review) | Turns a pull request into a logical reading order |
| [`/clementbresson:branch-tour`](#branch-tour) | Walks through a finished branch as an interactive page |
| [`/clementbresson:demo-video`](#demo-video) | Records a captioned demo video of a local web app |
| [`/clementbresson:ddd-map`](#ddd-map) | Maps a codebase's domain (DDD) as an interactive page |
| [`/clementbresson:backlog`](#backlog) | Keeps a repo-local backlog in `docs/todos/` |
| [`/clementbresson:orca-new-task`](#orca-new-task) | Starts a task: a supervised Orca worker does it and reports back |

## Install

No clone needed — Claude Code fetches the marketplace straight from GitHub.

```bash
claude plugin marketplace add clementbresson/claude-plugins
claude plugin install clementbresson@clementbresson
```

Or from inside a Claude Code session:

```
/plugin marketplace add clementbresson/claude-plugins
/plugin install clementbresson@clementbresson
```

Restart Claude Code afterwards so the skills load.

### Update

```bash
claude plugin marketplace update clementbresson
claude plugin update clementbresson@clementbresson
```

### Uninstall

```bash
claude plugin uninstall clementbresson@clementbresson
claude plugin marketplace remove clementbresson
```

---

## pr-review

GitHub lists a PR's changed files alphabetically, which has nothing to do with
how the change should be read. `pr-review` fixes that from inside GitHub itself:

1. **Hides the noise.** Lockfiles, generated output, snapshots, vendored code and
   pure renames are marked as *Viewed*, so GitHub collapses them natively.
2. **Orders the rest by dependency.** The order comes from the import graph
   (topological sort), so the same PR always gets the same order.
3. **Groups and explains.** Related files are grouped, each group with a short
   explanation of what changed.
4. **Writes a walkthrough into the PR description**, with a checkbox and a deep
   link per file.

It maps the PR; it does not review the code.

### Requirements

- [GitHub CLI](https://cli.github.com) installed and logged in (`gh auth status`)
- Write access to the PR (to edit its description)

### Usage

Open Claude Code in the repo and ask in plain words:

```
give me a reading order for PR 123
this PR is too big, walk me through it
```

Or call the skill directly. With no number it uses the PR of the current branch:

```
/clementbresson:pr-review 123
```

### What it changes on GitHub

- **PR description:** only the block between `<!-- pr-flow:start -->` and
  `<!-- pr-flow:end -->` is written. The rest of the description is left
  untouched, and re-running replaces just that block.
- **Viewed state:** noise files are ticked as *Viewed* for you only (viewed
  state is per-user). Every marked file is listed in the walkthrough and in
  Claude's reply. Untick any of them on the *Files changed* tab to bring it back.

---

## branch-tour

Call it when the work on a branch is done. It builds a private claude.ai
artifact that walks through **every** change on the branch the way a colleague
would walk you through the PR:

1. **Reading order.** Files are grouped into steps that each do one thing,
   foundations first (types, domain, use cases, wiring, UI), then side changes
   unrelated to the main story, then chores such as lockfiles.
2. **Explained.** A summary of the whole branch, a description per step, an
   optional note per file, and margin notes on the few regions that are hard
   to read.
3. **Interactive.** Every file shows its full diff with a *Seen* checkbox.
   Seen files collapse, a progress bar tracks the rest, and `j` / `k` / `s`
   move through the tour from the keyboard. While you scroll, the current
   step's number, title and first line stay pinned under the bar. As on GitHub, *Hide whitespace*
   drops indentation-only changes, and the arrows between hunks show the
   unchanged lines around them.

The page is always the same template. The diff comes straight from git (merge
base to working tree, so uncommitted and untracked files are included), and
the build refuses a tour that leaves out or repeats a changed file. Claude only
writes the order and the explanations.

Re-running on the same branch updates the same artifact. Seen marks carry over
for files whose diff has not changed since.

### Requirements

- Python 3 and git
- Claude Code with artifacts enabled (claude.ai login)

### Usage

```
/clementbresson:branch-tour            # compare with origin/HEAD, main or master
/clementbresson:branch-tour develop    # compare with another base branch
```

---

## demo-video

Ask for « a demo video of feature X ». Claude plans the story with you, writes
a scenario (plain JavaScript, one section per part of the story), and records
it in a headless Chrome on your local instance:

1. **Captions and a cursor.** Each step gets a numbered caption held long
   enough to read, and a visible cursor shows every click. Both survive page
   loads, even across origins.
2. **Fast-forwarded waits.** AI answers and page loads are squeezed to 1.5 s
   or less under a « ⏩ » badge; the rest plays at a quick human pace.
3. **No encoder to install.** Chrome records the video itself (WebM). When
   `ffmpeg` works, it writes an MP4 with chapters instead.
4. **Checked before and after.** A dry run must pass before the real take.
   Afterwards, one sample frame per section is checked and a chapter list
   is written next to the video.

### Requirements

- Google Chrome, Node 20+
- Playwright in the project, or `npm install --prefix ~/.cache/demo-video playwright-core`
  (no browser download: the system Chrome is used)

### Usage

```
/clementbresson:demo-video invoice reminders
```

---

## ddd-map

Ask for « a DDD analysis of this codebase ». Claude reads the domain out of
the code and publishes it as a private claude.ai page you browse top-down:

1. **The business domain**, from the docs, the code and the product's public
   website.
2. **Subdomains**, classified core, supporting or generic, each with the
   evidence for its type.
3. **The context map**: bounded contexts, the subdomains they implement, the
   external systems, and how they depend on each other (upstream and
   downstream, ACL, OHS, shared kernel…), each relationship with the code
   that proves it.
4. **Inside each context**: its ubiquitous language, aggregates with their
   invariants, entities and value objects with attributes and behaviour, use
   cases (commands and queries), domain events, services and findings. Every
   item links to its code.

A glossary puts side by side the terms that mean different things in
different contexts, and a search box finds any concept.

**Only where there is DDD to read.** The scan first measures how much of the
code uses DDD's own vocabulary (aggregate roots, value objects, domain
events, domain folders). On a codebase with none, it stops and says so
instead of inventing a model; ask again to map it anyway.

**Large codebases.** It is built for several hundred thousand lines. A
script inventories the code (size, churn, owners, schema, import graph,
vocabulary) and cuts it into slices of about 15k lines; one subagent
explores each slice and writes notes to disk; Claude merges the notes into
the strategic design; one subagent per context writes its tactical model and
checks it against the code. The script refuses a model that leaves source
files outside every context or cites code that does not exist. Everything is
kept in `.git/ddd-map/`, so an interrupted run resumes, and a re-run
re-explores only the slices whose code changed.

### Requirements

- Python 3 and git
- Claude Code with artifacts enabled (claude.ai login)

### Usage

```
/clementbresson:ddd-map                  # the whole repository
/clementbresson:ddd-map apps/api         # one part of it
```

---

## backlog

Sets up a backlog that lives in the repo, as plain markdown in `docs/todos/`:

1. **An index.** `TODO.md` lists every open ticket on one line, under CRITICAL,
   HIGH, MODERATE or LOW, most urgent first. It is the only place that holds a
   ticket's priority.
2. **One file per ticket.** Problem, fix, and conditions anyone can check. Closing
   a ticket deletes its file and its line, once those conditions are shown true.
3. **Blocks.** All the tickets of one big thing carry the same tag, and the block
   has one goal: the end state that says it is finished. Tickets keep their own
   priorities, so `backlog.sh blocks` prints each block with its tickets.
4. **References in no order.** `T-K7M2` instead of `T-025`, so parallel branches
   can file tickets without clashing, and an id says nothing about age or priority.

**Always the same format.** `backlog.sh new` creates each ticket from
`TEMPLATE.md`, with its type and date in frontmatter, and `backlog.sh check` rejects
a ticket or index line that strays from the format or keeps template text. Nothing
forces `check` to run unless a team adds it to CI.

**Agents use it on their own.** An agent that finds an issue it won't fix in the
current change files a ticket. In a repo with no backlog it creates nothing and
mentions the finding instead. The rules (`TODO_RULES.md`), the template, the script
and a pointer in `CLAUDE.md` or `AGENTS.md` all live in the repo, so collaborators
without the plugin get the same behaviour.

A repo with an older `docs/todos/` keeps its tickets and numeric ids when migrated.

### Requirements

- `sh`, git and the usual `grep`, `sed` and `awk`

### Usage

```
/clementbresson:backlog set up
/clementbresson:backlog add a todo: the login page flashes
/clementbresson:backlog what's next
/clementbresson:backlog close T-K7M2
```

---

## orca-new-task

Starts a new task. The agent in a repo's main checkout stays the orchestrator: it
investigates, plans, reviews and relays, and never does the work itself.

1. **A brief that stands alone.** Goal, done criteria, findings with `file:line`,
   decisions, constraints, verification and what not to do, written to a file.
2. **Your confirmation, every time.** One question per task, with the exact brief
   in the preview. An approval covers that one start.
3. **A worker in its own worktree.** A supervised Orca worker, always from the
   freshly fetched default branch and never from a linked worktree. The new
   worktree is revealed in the Orca app, as if you had created it there.
4. **Reports while you keep talking.** The orchestrator waits in the background,
   answers the worker's questions, checks its report and relays the outcome with
   its evidence. You land the work.

### Requirements

- [Orca](https://github.com/stablyai/orca) running, with its `orca` CLI on `PATH`.
  The skill refuses to start outside an Orca terminal or in a repo Orca doesn't manage
- `bash`, git, and a repo whose `origin/HEAD` is set

### Usage

```
/clementbresson:orca-new-task fix the flaky login test
/clementbresson:orca-new-task in ../other-repo, bump the shared schema
```

Tests, using a stub `orca` and temporary git repos:

```bash
bash plugins/clementbresson/skills/orca-new-task/tests/start-task.test.sh
```

---

## Local development

```bash
claude plugin validate ./plugins/clementbresson
claude plugin validate .
claude plugin marketplace add ./
claude plugin install clementbresson@clementbresson
```

A new skill goes in `plugins/clementbresson/skills/<name>/SKILL.md` and is
called as `/clementbresson:<name>`.

Bump `version` in `plugins/clementbresson/.claude-plugin/plugin.json` on each
release — installed copies only update when it changes.

## License

MIT
