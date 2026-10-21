// Every GitHub DOM hook the extension depends on. When GitHub changes its UI,
// this is the one file to repair: re-verify each entry and re-date it.
//
// Deliberately absent:
// - CSS-module classes (`diffEntry__YLOXdm`): the hash suffix churns on every
//   deploy. Instead, each direct child of diffList is identified by the file
//   anchor it contains, see applyOrder() in ../apply.ts.
// - Sidebar tree links (`a[href^="#diff-"]`): their text is the basename only
//   (`route.tsx`), so they can't map a path to its anchor.

export const SEL = {
  // verified 2026-10-21 on /pull/N/changes (React view; /files redirects here).
  // A flex column; its direct children are one wrapper per file plus a trailing
  // non-file child (the "all viewed" octocat). All files are present at once.
  diffList: '[data-testid="progressive-diffs-list"]',

  // verified 2026-10-21 on /pull/N/changes: id="diff-<hex sha256(path)>" on the
  // role="region" diff container, nested inside the file's list child. Same hash
  // as the plugin's deep links. Other ids share the prefix
  // (diff-comparison-viewer-container, diff-file-tree-filter), hence the regex.
  diffAnchorId: (sha256Hex: string) => `diff-${sha256Hex}`,
  diffAnchor: '[id^="diff-"]',
  diffAnchorIdPattern: /^diff-[0-9a-f]{64}$/,

  // verified 2026-10-21 on /pull/N fetched as HTML: the rendered description
  // keeps <span title> and strips HTML comments. See docs/DATA-CONTRACT.md.
  dataCarrier: 'span[title^="pr-flow:data "]',
} as const;
