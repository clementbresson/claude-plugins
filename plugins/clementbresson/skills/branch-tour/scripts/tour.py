#!/usr/bin/env python3
"""branch-tour: collect a branch's changes from git and render the tour page.

  tour.py files    [--base REF]                           list what changed
  tour.py build    [--base REF] --tour T.json --out P.html validate T.json, render P.html
  tour.py remember URL                                    store the artifact URL for this branch

The diff always comes from git, never from the model. The model's tour JSON
only orders, groups and explains; `build` refuses it unless every changed
file appears exactly once.
"""

import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "template" / "tour.html"
ROLES = ("main", "side", "chore")
MAX_LINES = 3000          # diff lines kept per file
NOISE_MAX_LINES = 300     # diff lines kept for lockfiles and generated files
COLLAPSE_OVER = 400       # changed lines above which a diff starts collapsed
EXPAND_MAX_LINES = 5000   # files longer than this ship without their unchanged lines
SIZE_WARN = 15 * 1024 * 1024

NOISE_PATTERNS = [
    (r"(^|/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|composer\.lock|go\.sum|Podfile\.lock)$", "lockfile"),
    (r"\.lock$", "lockfile"),
    (r"(^|/)(dist|build|out|\.next|coverage|vendor|node_modules)/", "generated"),
    (r"(\.gen\.|_pb\.|\.pb\.|\.min\.(js|css)$|\.snap$|(^|/)__snapshots__/)", "generated"),
]

LANGS = {
    "ts": "typescript", "tsx": "typescript", "mts": "typescript", "cts": "typescript",
    "js": "javascript", "jsx": "javascript", "mjs": "javascript", "cjs": "javascript",
    "py": "python", "rb": "ruby", "go": "go", "rs": "rust", "java": "java", "kt": "kotlin",
    "swift": "swift", "c": "c", "h": "c", "cpp": "cpp", "cc": "cpp", "hpp": "cpp", "cs": "csharp",
    "php": "php", "sql": "sql", "sh": "bash", "bash": "bash", "zsh": "bash",
    "json": "json", "yml": "yaml", "yaml": "yaml", "toml": "ini", "ini": "ini",
    "css": "css", "scss": "scss", "less": "less", "html": "xml", "xml": "xml", "svg": "xml",
    "vue": "xml", "md": "markdown", "mdx": "markdown", "graphql": "graphql", "gql": "graphql",
    "prisma": "typescript", "dockerfile": "dockerfile",
}


class TourError(Exception):
    pass


def git(*args, ok=(0,)):
    proc = subprocess.run(["git", "-c", "core.quotePath=false", *args],
                          capture_output=True, text=True, errors="replace")
    if proc.returncode not in ok:
        raise TourError(f"git {' '.join(args)} failed:\n{proc.stderr.strip()}")
    return proc.stdout


def resolve_base(base):
    candidates = [base] if base else []
    if not base:
        head = git("symbolic-ref", "--quiet", "refs/remotes/origin/HEAD", ok=(0, 1)).strip()
        if head:
            candidates.append(head.removeprefix("refs/remotes/"))
        candidates += ["origin/main", "origin/master", "main", "master"]
    for ref in candidates:
        if git("rev-parse", "--verify", "--quiet", ref + "^{commit}", ok=(0, 1)).strip():
            return ref
    raise TourError("No base branch found. Pass one with --base, e.g. --base develop.")


# ---------------------------------------------------------------- collect

def name_status(merge_base):
    out = git("diff", "-M", "--name-status", "-z", merge_base)
    parts = out.split("\0")
    entries, i = [], 0
    while i < len(parts) and parts[i]:
        status = parts[i]
        if status[0] in "RC":
            entries.append((status[0], parts[i + 1], parts[i + 2]))
            i += 3
        else:
            entries.append((status[0], parts[i + 1], parts[i + 1]))
            i += 2
    return entries


def split_patches(patch_text):
    chunks, current = [], None
    for line in patch_text.split("\n"):
        if line.startswith("diff --git "):
            current = []
            chunks.append(current)
        if current is not None:
            current.append(line)
    return chunks


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$")


def parse_hunks(lines):
    hunks, binary = [], False
    hunk, old_no, new_no = None, 0, 0
    for line in lines:
        m = HUNK_RE.match(line)
        if m:
            old_no, new_no = int(m.group(1)), int(m.group(3))
            hunk = {"oldStart": old_no, "oldLines": int(m.group(2) or 1),
                    "newStart": new_no, "newLines": int(m.group(4) or 1),
                    "context": m.group(5).strip(), "lines": []}
            hunks.append(hunk)
            continue
        if hunk is None:
            if line.startswith("Binary files ") or line.startswith("GIT binary patch"):
                binary = True
            continue
        if line.startswith("\\"):
            continue  # "\ No newline at end of file"
        kind, text = line[:1], line[1:]
        if kind == "+":
            hunk["lines"].append(["add", None, new_no, text])
            new_no += 1
        elif kind == "-":
            hunk["lines"].append(["del", old_no, None, text])
            old_no += 1
        elif kind == " ":
            hunk["lines"].append(["ctx", old_no, new_no, text])
            old_no += 1
            new_no += 1
    return hunks, binary


def noise_hint(path):
    for pattern, hint in NOISE_PATTERNS:
        if re.search(pattern, path):
            return hint
    return None


def language(path):
    name = os.path.basename(path).lower()
    if name == "dockerfile":
        return "dockerfile"
    return LANGS.get(name.rsplit(".", 1)[-1], "") if "." in name else ""


def cap_hunks(hunks, cap):
    kept, total, truncated = [], 0, False
    for h in hunks:
        if total >= cap:
            truncated = True
            break
        room = cap - total
        if len(h["lines"]) > room:
            h = {**h, "lines": h["lines"][:room]}
            truncated = True
        kept.append(h)
        total += len(h["lines"])
    return kept, truncated


def build_file(status, old_path, path, patch_lines):
    hunks, binary = parse_hunks(patch_lines)
    additions = sum(1 for h in hunks for l in h["lines"] if l[0] == "add")
    deletions = sum(1 for h in hunks for l in h["lines"] if l[0] == "del")
    hint = noise_hint(path)
    kept, truncated = cap_hunks(hunks, NOISE_MAX_LINES if hint else MAX_LINES)
    digest = hashlib.sha1(("\n".join(patch_lines)).encode()).hexdigest()[:16]
    return {
        "path": path,
        "oldPath": old_path if old_path != path else None,
        "status": status,
        "additions": additions,
        "deletions": deletions,
        "binary": binary,
        "hint": hint,
        "lang": language(path),
        "collapsed": bool(hint) or additions + deletions > COLLAPSE_OVER,
        "truncated": truncated,
        "key": "f_" + digest,
        "hunks": kept,
    }


def add_context(f, merge_base, root):
    """Give a modified file what the page needs to hide whitespace and expand unchanged lines.

    `hunksW` is the `git diff -w` view, set only when it differs from the plain diff.
    `lines` is the whole new file, so the page can reveal the lines between hunks.
    """
    if f["status"] not in "MR" or f["binary"] or f["hint"] or not f["hunks"]:
        return
    paths = dict.fromkeys(":(top,literal)" + p for p in (f["oldPath"], f["path"]) if p)
    chunks = split_patches(git("diff", "-w", "-M", "--no-color", "--no-ext-diff",
                               merge_base, "--", *paths))
    if len(chunks) <= 1:
        ws_hunks, _ = parse_hunks(chunks[0]) if chunks else ([], False)
        ws_hunks, ws_truncated = cap_hunks(ws_hunks, MAX_LINES)
        if ws_hunks != f["hunks"] and not ws_truncated:
            f["hunksW"] = ws_hunks

    full = root / f["path"]
    if f["truncated"] or full.is_symlink():
        return
    try:
        lines = full.read_text(encoding="utf-8", errors="replace").split("\n")
    except OSError:
        return
    if lines[-1] == "":
        lines.pop()
    last = f["hunks"][-1]
    end = last["newStart"] + last["newLines"] - (1 if last["newLines"] else 0)
    if len(lines) <= EXPAND_MAX_LINES and end <= len(lines):
        f["lines"] = lines


def collect(base_arg):
    if not git("rev-parse", "--is-inside-work-tree", ok=(0, 128)).strip() == "true":
        raise TourError("Not inside a git work tree.")
    base = resolve_base(base_arg)
    merge_base = git("merge-base", base, "HEAD").strip()
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()

    entries = name_status(merge_base)
    chunks = split_patches(git("diff", "-M", "--no-color", "--no-ext-diff", merge_base))
    if len(entries) != len(chunks):
        raise TourError(f"git listed {len(entries)} files but produced {len(chunks)} patches.")
    files = [build_file(s, old, new, chunk) for (s, old, new), chunk in zip(entries, chunks)]
    root = Path(git("rev-parse", "--show-toplevel").strip())
    for f in files:
        add_context(f, merge_base, root)

    untracked = [p for p in git("ls-files", "--others", "--exclude-standard", "-z").split("\0") if p]
    for path in untracked:
        patch = git("diff", "--no-index", "--no-color", "--", "/dev/null", path, ok=(0, 1))
        files.append(build_file("A", path, path, patch.split("\n")))
        files[-1]["untracked"] = True

    log = git("log", "--reverse", "--format=%h%x09%s", f"{merge_base}..HEAD")
    commits = [dict(zip(("sha", "subject"), l.split("\t", 1))) for l in log.splitlines() if l]
    dirty = any(True for _ in git("status", "--porcelain").splitlines())
    return {
        "branch": branch,
        "base": base,
        "mergeBase": merge_base[:10],
        "head": git("rev-parse", "--short", "HEAD").strip(),
        "repo": root.name,
        "commits": commits,
        "uncommitted": dirty,
        "files": files,
    }


# ---------------------------------------------------------------- remember

def store_path():
    return Path(git("rev-parse", "--git-common-dir").strip()) / "branch-tour.json"


def load_store():
    try:
        return json.loads(store_path().read_text())
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- validate

def validate(tour, files):
    errors = []
    by_path = {f["path"]: f for f in files}
    if tour.get("version") != 1:
        errors.append('"version" must be 1.')
    for key in ("title", "summary"):
        if not isinstance(tour.get(key), str) or not tour[key].strip():
            errors.append(f'"{key}" must be a non-empty string.')
    groups = tour.get("groups")
    if not isinstance(groups, list) or not groups:
        return errors + ['"groups" must be a non-empty list.']

    seen = {}
    for gi, group in enumerate(groups, 1):
        where = f"group {gi} ({group.get('title', '?')!r})"
        for key in ("title", "description"):
            if not isinstance(group.get(key), str) or not group[key].strip():
                errors.append(f'{where}: "{key}" must be a non-empty string.')
        if group.get("role", "main") not in ROLES:
            errors.append(f'{where}: "role" must be one of {", ".join(ROLES)}.')
        entries = group.get("files")
        if not isinstance(entries, list) or not entries:
            errors.append(f'{where}: "files" must be a non-empty list.')
            continue
        for entry in entries:
            path = entry.get("path") if isinstance(entry, dict) else None
            if path not in by_path:
                errors.append(f"{where}: {path!r} is not a changed file.")
                continue
            if path in seen:
                errors.append(f"{where}: {path!r} is already in group {seen[path]}.")
            seen[path] = gi
            errors += validate_focus(where, entry, by_path[path])

    missing = [p for p in by_path if p not in seen]
    if missing:
        errors.append("Changed files missing from the tour:\n  " + "\n  ".join(missing))
    return errors


def validate_focus(where, entry, file):
    errors = []
    for fi, focus in enumerate(entry.get("focus") or [], 1):
        label = f"{where}: {file['path']} focus {fi}"
        side = focus.get("side", "new")
        start, end = focus.get("start"), focus.get("end", focus.get("start"))
        if side not in ("new", "old"):
            errors.append(f'{label}: "side" must be "new" or "old".')
            continue
        if not isinstance(start, int) or not isinstance(end, int) or end < start:
            errors.append(f'{label}: "start"/"end" must be integers with end >= start.')
            continue
        if not isinstance(focus.get("note"), str) or not focus["note"].strip():
            errors.append(f'{label}: "note" must be a non-empty string.')
        col = 2 if side == "new" else 1
        shown = {l[col] for h in file["hunks"] for l in h["lines"] if l[col] is not None}
        if not any(n in shown for n in range(start, end + 1)):
            errors.append(f"{label}: {side} lines {start}-{end} are not in the diff "
                          f"(shown {side} lines: {ranges(sorted(shown))}).")
    return errors


def ranges(numbers):
    out, start = [], None
    for i, n in enumerate(numbers):
        if start is None:
            start = n
        if i + 1 == len(numbers) or numbers[i + 1] != n + 1:
            out.append(f"{start}-{n}" if n != start else str(n))
            start = None
    return ", ".join(out) or "none"


# ---------------------------------------------------------------- commands

def cmd_files(args):
    data = collect(args.base)
    previous = load_store().get(data["branch"])
    print(f"branch {data['branch']}  base {data['base']}  merge-base {data['mergeBase']}  "
          f"{len(data['commits'])} commits{'  + uncommitted changes' if data['uncommitted'] else ''}")
    if previous:
        print(f"previous tour {previous}")
    print(f"{len(data['files'])} files\n")
    for f in data["files"]:
        name = f"{f['oldPath']} -> {f['path']}" if f["oldPath"] else f["path"]
        tags = [t for t in (f["hint"], "binary" if f["binary"] else None,
                            "untracked" if f.get("untracked") else None) if t]
        print(f"{f['status']}  +{f['additions']:<5} -{f['deletions']:<5} {name}"
              + (f"  [{', '.join(tags)}]" if tags else ""))


def cmd_build(args):
    data = collect(args.base)
    try:
        tour = json.loads(Path(args.tour).read_text())
    except (OSError, ValueError) as e:
        raise TourError(f"Cannot read {args.tour}: {e}")
    errors = validate(tour, data["files"])
    if errors:
        print("Tour rejected:\n- " + "\n- ".join(errors), file=sys.stderr)
        sys.exit(1)

    by_path = {f["path"]: f for f in data["files"]}
    page = {
        **{k: v for k, v in data.items() if k != "files"},
        "title": tour["title"].strip(),
        "summary": tour["summary"].strip(),
        "groups": [{
            "title": g["title"].strip(),
            "role": g.get("role", "main"),
            "description": g["description"].strip(),
            "files": [{**by_path[e["path"]],
                       "note": (e.get("note") or "").strip(),
                       "focus": e.get("focus") or []} for e in g["files"]],
        } for g in tour["groups"]],
    }
    payload = json.dumps(page, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    out = TEMPLATE.read_text()
    out = out.replace("__TOUR_TITLE__", html.escape(page["title"]), 1)
    out = out.replace("__TOUR_DATA__", payload, 1)
    Path(args.out).write_text(out)

    size = len(out.encode())
    print(f"Wrote {args.out} ({size / 1024:.0f} KB, {len(data['files'])} files, "
          f"{len(page['groups'])} groups)")
    if size > SIZE_WARN:
        print("Warning: page is over 15 MB, close to the 16 MB artifact limit.", file=sys.stderr)


def cmd_remember(args):
    branch = git("rev-parse", "--abbrev-ref", "HEAD").strip()
    store = load_store()
    store[branch] = args.url
    store_path().write_text(json.dumps(store, indent=2) + "\n")
    print(f"Remembered {args.url} for {branch}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("files")
    p.add_argument("--base")
    p.set_defaults(run=cmd_files)
    p = sub.add_parser("build")
    p.add_argument("--base")
    p.add_argument("--tour", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(run=cmd_build)
    p = sub.add_parser("remember")
    p.add_argument("url")
    p.set_defaults(run=cmd_remember)
    args = parser.parse_args()
    try:
        args.run(args)
    except TourError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
