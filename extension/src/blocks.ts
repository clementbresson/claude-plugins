// The blocks the extension adds to the diff list: one per walkthrough group,
// plus one above each band of sunk files. They are the only nodes the extension
// inserts; GitHub's nodes are never moved. Text is set with textContent only:
// names and explanations are plain text (docs/DATA-CONTRACT.md).

export type BlockSpec = {
  key: string; // identity across re-applies; changes when the content does
  order: number;
  kicker: string;
  title: string;
  body: string;
  variant: 'group' | 'band';
  hue?: number; // group colour, shared with the group's file rails
  badge?: string;
  first: boolean;
};

const ATTR = 'data-prflow-block';

export function isBlock(el: Element): boolean {
  return el.hasAttribute(ATTR);
}

// Idempotent: creates missing blocks, removes stale ones, leaves the rest alone,
// so re-running it from a MutationObserver settles after one pass.
export function syncBlocks(list: Element, specs: BlockSpec[]): void {
  const existing = new Map([...list.children].filter(isBlock).map((el) => [el.getAttribute(ATTR), el]));
  for (const spec of specs) {
    if (existing.delete(spec.key)) continue;
    list.append(renderBlock(spec));
  }
  for (const stale of existing.values()) stale.remove();
}

function renderBlock(spec: BlockSpec): HTMLElement {
  const block = document.createElement('header');
  block.setAttribute(ATTR, spec.key);
  block.className = `prflow-block prflow-block--${spec.variant}${spec.first ? ' prflow-block--first' : ''}`;
  block.style.order = String(spec.order);
  if (spec.hue !== undefined) block.setAttribute('data-prflow-hue', String(spec.hue));
  if (spec.badge !== undefined) {
    const badge = element('span', 'prflow-block__badge', spec.badge);
    badge.setAttribute('aria-hidden', 'true');
    block.append(badge);
  }
  const text = document.createElement('div');
  text.append(
    element('p', 'prflow-block__kicker', spec.kicker),
    element('h2', 'prflow-block__title', spec.title),
    element('p', 'prflow-block__body', spec.body),
  );
  block.append(text);
  return block;
}

function element(tag: string, className: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}
