---
name: pr-review
description: Use when the user wants to review a GitHub pull request, asks for a walkthrough or reading order for a PR, or says a PR is too big or hard to follow. Produces a dependency-ordered, grouped walkthrough posted into the PR description, and marks noise files as viewed. Requires the gh CLI.
---

# PR reading order

Turn a pull request into something readable: hide the noise, order the rest by
dependency, explain each group, and write it all into the PR description.

## Preconditions

Check `gh auth status` first. Everything here runs through `gh`; no other
credentials are needed.

Resolve the PR from the argument if given, otherwise from the current branch
(`gh pr view --json number,url`). If neither resolves, ask. Take OWNER and REPO
from `gh repo view --json owner,name`.

## Step 1 — Gather

Fetch the changed files with their viewed state. GitHub caps a PR at 3000 files;
`--paginate` walks every page (it requires the cursor variable to be named
`$endCursor`).

```bash
gh api graphql --paginate -f query='
  query($owner:String!, $repo:String!, $number:Int!, $endCursor:String) {
    repository(owner:$owner, name:$repo) {
      pullRequest(number:$number) {
        id
        files(first:100, after:$endCursor) {
          pageInfo { hasNextPage endCursor }
          nodes { path additions deletions changeType viewerViewedState }
        }
      }
    }
  }' -F owner=OWNER -F repo=REPO -F number=N
```

Keep the pull request `id` — the viewed-state mutations need it.

Get the diff itself with `gh pr diff N`.

## Step 2 — Classify noise

Apply deterministic rules before asking yourself anything. A file is noise if:

- it is a lockfile (`*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `*.sum`)
- it is generated (`dist/`, `build/`, `*.gen.*`, `*_pb.*`, generated API clients)
- it is a snapshot (`__snapshots__/`, `*.snap`)
- it is vendored (`vendor/`, `node_modules/`)
- it is a pure rename (changeType `RENAMED` with 0 additions and 0 deletions)
- its diff touches only import paths, or only a single renamed identifier

Only files that none of these settle are worth a judgement call. When unsure,
treat the file as signal — a file wrongly shown costs a glance, a file wrongly
hidden costs a bug.

## Step 3 — Order the signal files

Build the import graph: parse import and require specifiers in each changed
file, keep only edges pointing at other files in the same PR, topologically
sort.

Files with no resolved in-PR dependency keep their original position. Import
cycles fall back to original order. The same PR must produce the same order
every time — never reorder on taste.

## Step 4 — Group and explain

Group the ordered files into blocks that do one thing together. Each group gets
a short name and two or three sentences: what changed, and how the files relate.

Write affirmatively. Do not review the code, do not flag bugs — this is a map,
not an opinion.

## Step 5 — Mark the noise as viewed

For each noise file:

```bash
gh api graphql -f query='
  mutation($pullRequestId:ID!, $path:String!) {
    markFileAsViewed(input:{pullRequestId:$pullRequestId, path:$path}) {
      clientMutationId
    }
  }' -F pullRequestId=PR_ID -F path=PATH
```

Never mark a signal file. Always report the full list of what was marked, and
tell the user they can untick any of them on GitHub, or undo one from the
terminal with the same call using `unmarkFileAsViewed`.

## Step 6 — Write the walkthrough

Build a deep link per file. The anchor is the SHA-256 of the file path:

```bash
https://github.com/OWNER/REPO/pull/N/files#diff-$(printf '%s' "PATH" | shasum -a 256 | cut -d' ' -f1)
```

Read the current body with `gh pr view N --json body -q .body`. Replace the
block between the markers, leaving the rest of the body untouched; if there is
no block yet, append one. Then `gh pr edit N --body-file`.

```markdown
<!-- pr-flow:start -->

## Reading order

**1 — <group name>**
<two or three sentences>

- [ ] [path/to/file.ts](deep link)
- [ ] [path/to/other.ts](deep link)

**2 — <group name>**
...

<details><summary>N files auto-marked as viewed</summary>

lockfiles, generated output and renames — untick any on the Files changed tab.

</details>

<!-- pr-flow:data {"version":1,"groups":[{"name":"...","files":["..."],"explanation":"..."}],"noise":["..."]} -->
<!-- pr-flow:end -->
```

The task-list checkboxes are interactive in GitHub's rendered description, so
progress persists with no state of our own.

The `pr-flow:data` block is the contract for a future renderer. Emit it even
though nothing reads it yet.

## Re-runs

Re-running on the same PR replaces the marked block and nothing else. Files
GitHub has flipped to `DISMISSED` changed since the last read — call those out
at the top rather than silently reordering everything.
