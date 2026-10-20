# claude-plugins

Claude Code plugins I use across projects, published as the `clementbresson` marketplace.

| Plugin | What it does |
|---|---|
| [`pr-flow`](#pr-flow) | Turns a pull request into a logical reading order |

## Install

No clone needed — Claude Code fetches the marketplace straight from GitHub.

```bash
claude plugin marketplace add clementbresson/claude-plugins
claude plugin install pr-flow@clementbresson
```

Or from inside a Claude Code session:

```
/plugin marketplace add clementbresson/claude-plugins
/plugin install pr-flow@clementbresson
```

Restart Claude Code afterwards so the skills load.

### Update

```bash
claude plugin marketplace update clementbresson
claude plugin update pr-flow@clementbresson
```

### Uninstall

```bash
claude plugin uninstall pr-flow@clementbresson
claude plugin marketplace remove clementbresson
```

---

## pr-flow

GitHub lists a PR's changed files alphabetically, which has nothing to do with
how the change should be read. `pr-flow` fixes that from inside GitHub itself:

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
/pr-flow:pr-review 123
```

### What it changes on GitHub

- **PR description:** only the block between `<!-- pr-flow:start -->` and
  `<!-- pr-flow:end -->` is written. The rest of the description is left
  untouched, and re-running replaces just that block.
- **Viewed state:** noise files are ticked as *Viewed* for you only (viewed
  state is per-user). Every marked file is listed in the walkthrough and in
  Claude's reply. Untick any of them on the *Files changed* tab to bring it back.

---

## Local development

```bash
claude plugin validate ./plugins/pr-flow
claude plugin validate .
claude plugin marketplace add ./
claude plugin install pr-flow@clementbresson
```

Bump `version` in the plugin's `plugin.json` on each release — installed copies
only update when it changes.

## License

MIT
