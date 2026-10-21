export type PullRef = { owner: string; repo: string; number: number };

// verified 2026-10-21: /{owner}/{repo}/pull/{n} is the conversation page,
// /pull/{n}/changes the diff view (/pull/{n}/files redirects to it).
export function parsePullPath(pathname: string): PullRef | null {
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(pathname);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

export function conversationPath(pull: PullRef): string {
  return `/${pull.owner}/${pull.repo}/pull/${pull.number}`;
}
