import type { PrFlowData } from './data.ts';

// CSS `order` values. Walkthrough files are spaced by STEP so each group's block
// slots in just before the group's first file. Everything else sinks below, in
// three bands, each with room for a block above it; flex keeps DOM order
// (GitHub's) among equal values.
export const STEP = 10;
export const BLOCK_OFFSET = STEP / 2;
export const UNLISTED = 1_000_000; // changed files the walkthrough doesn't mention
export const NOISE = UNLISTED + STEP; // files the skill marked as viewed
export const NOT_A_FILE = UNLISTED + 2 * STEP; // list children without a diff

export type GroupPlan = {
  order: number;
  number: number; // 1-based, matches the numbering in the PR description
  total: number;
  name: string;
  explanation: string;
  fileCount: number;
};

export type Plan = {
  files: Map<string, number>; // path -> order value
  groups: GroupPlan[]; // groups that own at least one file
};

// A path listed twice keeps its first position.
export function planOrder(data: PrFlowData): Plan {
  const files = new Map<string, number>();
  const groups: GroupPlan[] = [];
  let position = 0;
  data.groups.forEach((group, index) => {
    const first = position + 1;
    for (const path of group.files) {
      if (!files.has(path)) files.set(path, ++position * STEP);
    }
    const fileCount = position - first + 1;
    if (fileCount === 0) return;
    groups.push({
      order: first * STEP - BLOCK_OFFSET,
      number: index + 1,
      total: data.groups.length,
      name: group.name,
      explanation: group.explanation,
      fileCount,
    });
  });
  for (const path of data.noise) {
    if (!files.has(path)) files.set(path, NOISE);
  }
  return { files, groups };
}
