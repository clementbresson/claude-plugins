import { type BlockSpec, isBlock, syncBlocks } from './blocks.ts';
import type { PrFlowData } from './data.ts';
import { diffAnchorId } from './github/anchor.ts';
import { SEL } from './github/selectors.ts';
import { BLOCK_OFFSET, type GroupPlan, NOISE, NOT_A_FILE, planOrder, UNLISTED } from './order.ts';

export type AnchoredPlan = { files: Map<string, number>; groups: GroupPlan[] };

// Same plan, keyed by anchor id instead of path; hashed once per PR.
export async function anchoredPlan(data: PrFlowData): Promise<AnchoredPlan> {
  const { files, groups } = planOrder(data);
  const entries = await Promise.all(
    [...files].map(async ([path, order]) => [await diffAnchorId(path), order] as const),
  );
  return { files: new Map(entries), groups };
}

const HUE_ATTR = 'data-prflow-hue';
const HUES = 6; // colours cycle; see content.css

// Sets an inline `order` on every GitHub child of the list, tags walkthrough
// files with their group's colour, and syncs the blocks. No GitHub node is moved
// or removed, so React's reconciler never notices. Idempotent: safe to re-run
// whenever the list's children change.
export function applyWalkthrough(list: Element, plan: AnchoredPlan): void {
  let unlisted = 0;
  let noise = 0;
  for (const child of list.children) {
    if (isBlock(child)) continue;
    const id = fileAnchor(child)?.id;
    const order = id === undefined ? NOT_A_FILE : (plan.files.get(id) ?? UNLISTED);
    (child as HTMLElement).style.order = String(order);
    if (order === UNLISTED) unlisted++;
    if (order === NOISE) noise++;

    const group = order < UNLISTED ? groupAt(order, plan.groups) : undefined;
    if (group) child.setAttribute(HUE_ATTR, String(hue(group)));
    else child.removeAttribute(HUE_ATTR);
  }

  const blocks: BlockSpec[] = plan.groups.map((group, index) => ({
    key: `group:${group.number}:${group.name}`,
    order: group.order,
    kicker: `Group ${group.number} of ${group.total} · ${files(group.fileCount)}`,
    title: group.name,
    body: group.explanation,
    variant: 'group',
    hue: hue(group),
    badge: String(group.number),
    first: index === 0,
  }));
  if (unlisted > 0) {
    blocks.push({
      key: `unlisted:${unlisted}`,
      order: UNLISTED - BLOCK_OFFSET,
      kicker: files(unlisted),
      title: 'Not in the walkthrough',
      body: 'Changed files pr-flow did not group, usually commits pushed after it ran. Re-run pr-flow to place them.',
      variant: 'band',
      first: blocks.length === 0,
    });
  }
  if (noise > 0) {
    blocks.push({
      key: `noise:${noise}`,
      order: NOISE - BLOCK_OFFSET,
      kicker: files(noise),
      title: 'Marked as viewed',
      body: 'Lockfiles, generated output and pure renames that pr-flow marked as viewed. Untick Viewed on any of them to read it.',
      variant: 'band',
      first: blocks.length === 0,
    });
  }
  syncBlocks(list, blocks);
}

// The group whose block sits closest above this order value.
function groupAt(order: number, groups: GroupPlan[]): GroupPlan | undefined {
  return groups.findLast((group) => group.order < order);
}

function hue(group: GroupPlan): number {
  return (group.number - 1) % HUES;
}

function files(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

function fileAnchor(entry: Element): Element | undefined {
  return [...entry.querySelectorAll(SEL.diffAnchor)].find((el) => SEL.diffAnchorIdPattern.test(el.id));
}
