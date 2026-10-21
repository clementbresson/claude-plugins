# pr-flow extension

Reorders a pull request's files on GitHub's *Files changed* page into the
reading order the [pr-flow plugin](../plugins/pr-flow) wrote into the PR
description, with a block above each group showing its name and explanation.
Each group has a colour, and its files carry a rail in that colour. It makes
no API calls and no model calls, and on a PR without a pr-flow block it does
nothing.

The data it reads is defined in [`docs/DATA-CONTRACT.md`](../docs/DATA-CONTRACT.md).
Every GitHub DOM hook it uses is in [`src/github/selectors.ts`](src/github/selectors.ts).

## Develop

```bash
pnpm install
pnpm test         # parser, ordering, anchors, routes
pnpm build        # → dist/
pnpm watch        # rebuild on change
```

Load it in Chrome: `chrome://extensions` → *Developer mode* → *Load unpacked* →
pick `extension/dist`. After a rebuild, hit the reload icon on the extension's
card and refresh the GitHub tab.
