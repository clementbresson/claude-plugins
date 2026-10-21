import { SEL } from './selectors.ts';

// The anchor id GitHub gives a file's diff: diff-<hex sha256(utf8 path)>.
// WebCrypto, no hashing library; same hash the plugin puts in its deep links.
export async function diffAnchorId(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return SEL.diffAnchorId(hex);
}
