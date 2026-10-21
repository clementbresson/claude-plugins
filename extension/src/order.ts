import type { PrFlowData } from './data.ts';

// CSS `order` values. Walkthrough files are spaced by STEP so group headers can
// slot in just before a group's first file. Everything else sinks below, in
// three bands; flex keeps DOM order (GitHub's) among equal values.
export const STEP = 10;
export const UNLISTED = 1_000_000; // changed files the walkthrough doesn't mention
export const NOISE = UNLISTED + 1; // files the skill marked as viewed
export const NOT_A_FILE = UNLISTED + 2; // list children without a diff

// path -> order value. A path listed twice keeps its first position.
export function planOrder(data: PrFlowData): Map<string, number> {
  const plan = new Map<string, number>();
  let position = 0;
  for (const group of data.groups) {
    for (const path of group.files) {
      if (!plan.has(path)) plan.set(path, ++position * STEP);
    }
  }
  for (const path of data.noise) {
    if (!plan.has(path)) plan.set(path, NOISE);
  }
  return plan;
}
