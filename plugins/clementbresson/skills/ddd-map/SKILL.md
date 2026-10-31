---
name: ddd-map
description: Use when the user asks for a domain-driven design (DDD) analysis of a codebase, its business domain, subdomains, bounded contexts, context map or aggregates. Builds an interactive top-down map of the domain from the code, and scales to codebases of several hundred thousand lines.
argument-hint: "[path to limit the analysis to]"
---

# DDD map

Read a codebase's domain out of its code and publish it as an interactive
page: the business domain, its subdomains (core, supporting, generic), the
bounded contexts implementing them and the context map between them, then
inside each context its language, aggregates, entities, value objects, use
cases, events and findings, each linked to its code.

The work is split so it fits any size of codebase:

- `scripts/ddd.py` does everything mechanical: it inventories the code
  (lines, churn, owners, schema, import graph, vocabulary), cuts it into
  **slices** of about 15k lines, validates every file you write, and builds
  the page from a fixed template.
- **Explorers**, one subagent per slice, read the code and write notes.
- You merge the notes into the strategic design.
- **Modelers**, one subagent per context, write each context's tactical
  model and check it against the code.

Everything lives in a **workspace** in the main checkout
(`.ddd-map/<scope>/`, which the script ignores locally through
`.git/info/exclude`): `inventory.json`, `brief.md`, `notes/`,
`areas/` (large codebases only), `model/domain.json`,
`model/contexts/<id>.json`, `map.html`. It survives the
session, so an interrupted analysis resumes where it stopped, and a re-run
re-explores only the slices whose code changed.

`DDD` below is `python3 ${CLAUDE_SKILL_DIR}/scripts/ddd.py`, `REF` is
`${CLAUDE_SKILL_DIR}/reference`. Run every command from the repository root.
When `$ARGUMENTS` names paths, pass each as `--scope PATH` to every command,
and to every subagent.

## Step 1 — Scan

```bash
DDD scan [--scope PATH]
```

It prints the workspace, the source size per language, the **DDD fit**, the
manifests, docs and schema, one line per **unit** (a folder of at most 4k lines: its lines,
commits in the last year, authors, signals and vocabulary), import clusters,
type names declared in several units, and the slices with their state.

**The DDD fit decides whether there is a map to draw.** It counts the files
that use DDD's own vocabulary (aggregate root, value object, domain event…)
and the domain folders; ORM models and repository classes alone do not
count, since every CRUD app has them.

- `ddd`: continue.
- `partial`: continue, and tell the user in one line that most of the
  tactical model will be inferred, and marked so on the page.
- `none`: stop here, before any subagent. Reply with the fit lines, what the
  code is instead (a UI, CRUD over an ORM, a library, tooling), and that a
  DDD map of it would be invented rather than read from the code. Go on only
  when the user asks to map it anyway, in the request or after this reply;
  every aggregate of that map is then marked inferred.

Then look in the workspace for what an earlier run left, and continue from
the first step whose output is missing: `brief.md` (step 2), notes for every
slice (step 3), `model/domain.json` (step 4), one `model/contexts/<id>.json`
per internal context (step 5). When files from an earlier run exist, start
from them and change only what the new evidence contradicts or adds.

With 2 slices or fewer, the codebase is small: skip the subagents, outline
and read the code yourself, then write the model directly (steps 4 and 5).

Done when the fit allows going on and you know which step comes next.

## Step 2 — Orient and write the brief

Learn what the business is before reading its code. Read the README and the
docs the scan lists (product docs, ADRs, API specs; skip agent and tooling
notes), the schema names, and the vocabulary of the largest and most-changed
units. When the README, a `package.json` homepage or a landing page names a
public product or company, search the web for what it sells, to whom and how
it earns money.

Write `WS/brief.md` for the explorers, in under 60 lines:

- the business in one paragraph: customers, offer, revenue;
- candidate subdomains, one line each;
- the vocabulary: business terms with a short meaning, including the
  non-English ones the code uses;
- the codebase's conventions an explorer needs: where domain code lives,
  how layers are named, what the main frameworks and ORM are.

Done when `brief.md` exists.

## Step 3 — Explore every slice

For each slice that `DDD status` shows as `todo`, start a `general-purpose`
subagent in the background with this prompt (filled in):

> Read REF/explorer.md and follow it. Slice: SID. Workspace: WS. Script:
> `python3 SKILL_DIR/scripts/ddd.py`. Repository root: ROOT. Scope flags:
> FLAGS (or none).

Keep at most 6 explorers running; start the next one each time one reports.
Their replies are one line each; their notes stay on disk.

Done when `DDD status --check` exits 0: every slice has a note that
validates.

## Step 4 — Strategic design

Read the merged notes. `DDD digest --brief` prints their size on its first
line, in tokens:

- **Under about 120k tokens**: read `DDD digest` (or `--brief` past 60k).
- **Above**: reduce by area first. Cut the slices into groups of neighbours
  (consecutive ids) of about 60k brief tokens each, and give each group to a
  `general-purpose` subagent: "Read REF/area.md and follow it. Slices:
  IDS. Workspace: WS. Script: … Repository root: ROOT. Scope flags: FLAGS."
  At most 6 at once. Then read every `WS/areas/*.md`, and
  `DDD digest --cross` for the concepts, terms and imports shared between
  slices.

Open the full notes of a slice (`DDD digest --slices sNN`) or the code
whenever a boundary hangs on a detail.

Read `REF/modeling.md`, sections *Strategic design* and `domain.json`, and
write `WS/model/domain.json`: the business domain, the subdomains with their
type and why, the bounded contexts with their paths, the external systems,
the relationships with their patterns and evidence, and `unassigned` for
code that belongs to no context.

Then run `DDD build`. At this point it also reports the missing context
files; fix every other problem it lists. Coverage is part of it: every
source file belongs to a context or to `unassigned`.

Done when the only problems left are `missing …/contexts/<id>.json`.

## Step 5 — Model each context

For each internal context without a valid file, start a `general-purpose`
subagent in the background:

> Read REF/modeler.md and follow it. Context: ID. Workspace: WS. Script:
> `python3 SKILL_DIR/scripts/ddd.py`. Repository root: ROOT. Scope flags:
> FLAGS (or none).

Same limit: at most 6 at once. A context too small to deserve an agent
(under about 2k lines) you can write yourself, with
`DDD digest --context ID` and `DDD check-context ID`.

Done when `DDD check-context ID` prints `ok` for every internal context.

## Step 6 — Build

```bash
DDD build
```

It validates the whole model at once (ids, cross-references, every code
reference against the files, coverage) and writes `WS/map.html`. Fix the
model and build again until it prints `Wrote …`.

Before publishing, read the glossary and findings sections of the context
files once: a term that two contexts define the same way, or a finding that
contradicts a relationship, means two files disagree; fix the one that is
wrong.

Done when `build` prints `Wrote …`.

## Step 7 — Publish

Publish `WS/map.html` with the Artifact tool, `icon: "map"` on a first
publish, and a one-sentence `description` such as "Domain map of the Acme
monorepo: 4 subdomains, 9 bounded contexts, 31 aggregates."

When the scan printed a `previous map URL`, update that artifact instead:
read it (`action: "read"`), then publish with its `url` and without `icon`.
After a first publish, keep the URL for the next run:

```bash
DDD remember URL [--scope PATH]
```

## Step 8 — Hand over

Reply with the link, the business domain in one sentence, the subdomains by
type, the contexts and how many aggregates and use cases the map holds, the
three findings that matter most, how much was inferred rather than explicit
in the code, and the workspace path (a re-run reuses its notes).
