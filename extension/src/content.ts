import { type AnchoredPlan, anchoredPlan, applyWalkthrough } from './apply.ts';
import { parseData } from './data.ts';
import { conversationPath, parsePullPath, type PullRef } from './github/route.ts';
import { SEL } from './github/selectors.ts';

// GitHub is a single-page app: this script is injected once per full page load,
// on any github.com page, because a soft navigation into a PR never re-injects
// it. Instead of tracking history events, watch for the diff list to appear.

let attached: { list: Element; pullKey: string } | null = null;
let listObserver: MutationObserver | null = null;

const check = debounce(() => {
  const list = document.querySelector(SEL.diffList);
  const pull = parsePullPath(location.pathname);
  const pullKey = pull ? conversationPath(pull) : '';
  if (list === attached?.list && pullKey === attached.pullKey) return;

  listObserver?.disconnect();
  listObserver = null;
  attached = list && pull ? { list, pullKey } : null;
  if (attached && pull) void attach(attached, pull);
}, 100);

new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
check();

async function attach(target: NonNullable<typeof attached>, pull: PullRef): Promise<void> {
  const plan = await loadPlan(pull);
  // No data block, or the user navigated away while we were fetching.
  if (!plan || attached !== target) return;

  applyWalkthrough(target.list, plan);
  // Entries that mount later (very large PRs) get their order as they arrive.
  // Our own block insertions trigger one more pass, which changes nothing.
  listObserver = new MutationObserver(debounce(() => applyWalkthrough(target.list, plan), 50));
  listObserver.observe(target.list, { childList: true });
}

// The data block lives in the description, which only the conversation page
// renders. Same-origin fetch with the user's cookies; no API, no token.
async function loadPlan(pull: PullRef): Promise<AnchoredPlan | null> {
  try {
    const response = await fetch(conversationPath(pull), { credentials: 'same-origin' });
    if (!response.ok) return null;
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const title = page.querySelector(SEL.dataCarrier)?.getAttribute('title');
    const data = title ? parseData(title) : null;
    return data ? await anchoredPlan(data) : null;
  } catch {
    return null;
  }
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}
