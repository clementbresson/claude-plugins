// Parser for the pr-flow:data block. The shape, encoding and validation rules
// are defined in docs/DATA-CONTRACT.md; change that file first.

export type Group = { name: string; files: string[]; explanation: string };
export type PrFlowData = { version: 1; groups: Group[]; noise: string[] };

const PREFIX = 'pr-flow:data ';

// Takes the carrier's decoded `title` attribute. All-or-nothing: anything that
// doesn't match the contract returns null, and the extension does nothing.
export function parseData(title: string): PrFlowData | null {
  if (!title.startsWith(PREFIX)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(title.slice(PREFIX.length));
  } catch {
    return null;
  }
  if (!isRecord(raw) || raw.version !== 1) return null;
  if (!Array.isArray(raw.groups) || !raw.groups.every(isGroup)) return null;
  if (!isStringArray(raw.noise)) return null;
  return {
    version: 1,
    groups: raw.groups.map(({ name, files, explanation }) => ({ name, files, explanation })),
    noise: raw.noise,
  };
}

function isGroup(value: unknown): value is Group {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.explanation === 'string' &&
    isStringArray(value.files)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
