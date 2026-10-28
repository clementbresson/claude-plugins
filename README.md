# claude-plugins

Claude Code skills I use across projects, shipped as one plugin, `clementbresson`,
so every skill is called as `/clementbresson:<skill>`.

| Skill | What it does |
|---|---|
| [`/clementbresson:pr-review`](#pr-review) | Turns a pull request into a logical reading order |
| [`/clementbresson:branch-tour`](#branch-tour) | Walks through a finished branch as an interactive page |
| [`/clementbresson:demo-video`](#demo-video) | Records a captioned demo video of a local web app |

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
