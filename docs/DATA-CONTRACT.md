# pr-flow data contract — version 1

The `pr-flow:data` block is the only thing the pr-flow plugin and the pr-flow
browser extension share. This file is its single definition.

| Side | Where | What it does |
|---|---|---|
| Producer | `plugins/pr-flow/skills/pr-review/SKILL.md`, step 6 | writes the block into the PR description |
| Consumer | `extension/src/data.ts` | parses and validates it |

Change this file first, then both sides, in the same commit.

---

## Carrier

One line, inside the `<!-- pr-flow:start -->` / `<!-- pr-flow:end -->` block:

```html
<span title='pr-flow:data {"version": 1, "groups": [...], "noise": [...]}'></span>
```

- An empty `<span>` renders as nothing, and GitHub's sanitizer keeps its `title`.
- **Not an HTML comment.** GitHub strips comments from the rendered
  description, so a comment can only be read through the API, and the
  extension never calls the API. Verified 2026-10-21 on `/pull/N`, its
  `/pull/N/partials/body` fragment and `/pull/N/changes`.
- The attribute is single-quoted, and its value is the prefix
  `pr-flow:data ` (one space) followed by the JSON.
- A description carries exactly one carrier.

### Encoding (producer)

- The JSON is on one line.
- Inside the JSON, escape these four characters as JSON unicode escapes:

  | Char | Escape |
  |---|---|
  | `'` | `'` |
  | `<` | `<` |
  | `>` | `>` |
  | `&` | `&` |

  With these escapes, nothing in the JSON can close the attribute or the tag,
  and the sanitizer has nothing to rewrite. Every JSON parser turns them back
  into the original characters. Other non-ASCII characters (`«`, `é`) can stay
  as they are.

In Python:

```python
json.dumps(data, ensure_ascii=False) \
    .replace("&", "\\u0026").replace("<", "\\u003c") \
    .replace(">", "\\u003e").replace("'", "\\u0027")
```

### Reading (consumer)

- **From the rendered page:** select `span[title^="pr-flow:data "]`, read
  `title` (the browser has already decoded the entities), strip the prefix, and
  `JSON.parse` what's left.
- **From the raw description** (API readers): match
  `<span title='pr-flow:data (.*?)'></span>`, then `JSON.parse` the capture.
  Because of the escapes, no HTML decoding is needed.

Verified 2026-10-21: a real 22-file payload, with `'`, `<b>`, `-->`, `&` and
markdown characters added to an explanation, came back byte-identical through
GitHub's markdown renderer.

---

## Shape

```ts
type PrFlowData = {
  version: 1;
  groups: Array<{
    name: string;         // short group title, plain text, no number prefix
    files: string[];      // paths, in reading order
    explanation: string;  // two or three sentences, plain text
  }>;
  noise: string[];        // paths the skill marked as viewed
};
```

Example:

```json
{"version": 1, "groups": [{"name": "The schema", "files": ["api/schema.graphql"], "explanation": "Adds the Invoice type."}, {"name": "Resolvers", "files": ["api/invoice.ts", "api/invoice.test.ts"], "explanation": "Resolves Invoice from the billing table."}], "noise": ["pnpm-lock.yaml"]}
```

### Semantics

- **Reading order** is the groups in array order, with each group's files in
  array order. The numbering shown to humans (`1 — …`) is the group's position
  and is not stored.
- **Paths** are repo-relative, exactly as GitHub's GraphQL
  `pullRequest.files.nodes.path` returns them: the post-rename path, forward
  slashes, no leading `./`.
- **A path appears at most once** across all groups and `noise`. If the
  producer breaks this rule, the consumer keeps the first occurrence.
- **`noise`** lists the files the skill marked as viewed. They are never in a
  group.
- **Changed files listed nowhere**, for example files pushed after the skill
  ran, are not an error. The consumer keeps them and places them after the
  walkthrough.
- **`name` and `explanation` are plain text.** The consumer renders them as
  text, never as HTML or markdown.
- **The file anchor** on the changes page is `diff-` followed by the hex
  SHA-256 of the UTF-8 path. Both sides compute it themselves; it is not part
  of the data.

### Validation (consumer)

The block is all-or-nothing. If the JSON doesn't parse, `version` isn't `1`, or
any field has the wrong type, the consumer treats the PR as having no block and
does nothing. Unknown extra keys are ignored.

### Versioning

- Adding an optional key is allowed within version 1. Consumers ignore keys they
  don't know.
- Renaming, removing or changing the meaning of a key requires `"version": 2`.
  A consumer does nothing on a version it doesn't know.
