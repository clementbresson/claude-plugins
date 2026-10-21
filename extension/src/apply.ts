import type { PrFlowData } from './data.ts';
import { diffAnchorId } from './github/anchor.ts';
import { SEL } from './github/selectors.ts';
import { NOT_A_FILE, planOrder, UNLISTED } from './order.ts';

// anchor id -> order value, hashed once per PR.
export async function anchoredPlan(data: PrFlowData): Promise<Map<string, number>> {
  const entries = await Promise.all(
    [...planOrder(data)].map(async ([path, order]) => [await diffAnchorId(path), order] as const),
  );
  return new Map(entries);
}

// Sets an inline `order` on every direct child of the list. No node is moved or
// removed, so React's reconciler never notices. Idempotent: safe to re-run
// whenever the list's children change.
export function applyOrder(list: Element, plan: Map<string, number>): void {
  for (const child of list.children) {
    const id = fileAnchor(child)?.id;
    const order = id === undefined ? NOT_A_FILE : (plan.get(id) ?? UNLISTED);
    (child as HTMLElement).style.order = String(order);
  }
}

function fileAnchor(entry: Element): Element | undefined {
  return [...entry.querySelectorAll(SEL.diffAnchor)].find((el) => SEL.diffAnchorIdPattern.test(el.id));
}
