#!/usr/bin/env python3
"""Domain map of a codebase, for codebases of any size. Standard library only.

  scan           inventory the code, cut it into slices for explorers, print an overview
  status         which slices still need notes
  outline        declarations and signals of one slice (or path), for reading it in order
  check-notes    validate the explorers' notes
  digest         all notes merged into one compact listing, for the synthesis
  check-context  validate one context's tactical model
  build          validate the model and inject it into the page template
  remember URL   keep the published page's URL, so re-runs update the same artifact

Everything lands in a workspace outside the work tree (<git dir>/ddd-map/<scope>),
so a long analysis survives the session and a re-run reuses unchanged notes.
"""

import argparse
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL / "template" / "map.html"

LANG = {
    ".ts": "ts", ".tsx": "ts", ".mts": "ts", ".cts": "ts", ".js": "ts", ".jsx": "ts", ".mjs": "ts", ".cjs": "ts",
    ".vue": "ts", ".svelte": "ts", ".py": "py", ".java": "jvm", ".kt": "kt", ".kts": "kt", ".scala": "jvm",
    ".groovy": "jvm", ".cs": "cs", ".fs": "cs", ".go": "go", ".rb": "rb", ".php": "php", ".rs": "rs",
    ".ex": "ex", ".exs": "ex", ".swift": "jvm", ".dart": "dart",
}
SCHEMA_EXT = {".prisma", ".sql", ".graphql", ".gql", ".proto", ".avsc"}
UI_EXT = {".tsx", ".jsx", ".vue", ".svelte"}
SKIP_DIRS = {
    "node_modules", "vendor", "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".svelte-kit", ".turbo",
    ".cache", "__pycache__", ".venv", "venv", "Pods", "bin", "obj", "generated", "__generated__", ".git", ".idea",
    ".vscode", "storybook-static", ".expo", ".gradle", ".dart_tool",
}
TEST_DIRS = {"test", "tests", "__tests__", "spec", "specs", "e2e", "__mocks__", "fixtures", "testing", "cypress", "testdata"}
TEST_FILE = re.compile(r"(\.|_)(test|spec)s?\.\w+$|^test_.*\.py$|_test\.go$|Tests?\.(java|kt|cs|scala)$|_spec\.rb$|\.stories\.\w+$")
MIGRATION_DIRS = {"migrations", "migrate", "db/migrate", "alembic"}
GENERATED_FILE = re.compile(r"\.min\.js$|\.pb\.go$|_pb2\.py$|\.g\.dart$|\.generated\.\w+$|\.d\.ts$|\.gen\.\w+$")
GENERATED_MARK = re.compile(r"@generated|DO NOT EDIT|auto-?generated|Code generated", re.I)
MANIFESTS = {
    "package.json", "pom.xml", "build.gradle", "build.gradle.kts", "go.mod", "Cargo.toml", "pyproject.toml",
    "setup.py", "composer.json", "Gemfile", "mix.exs", "Dockerfile", "serverless.yml", "pubspec.yaml",
}

IMPORTS = {
    "ts": [r"""(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]""", r"""^\s*import\s*['"]([^'"]+)['"]""",
           r"""(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)"""],
    "py": [r"^\s*from\s+([.\w]+)\s+import", r"^\s*import\s+([\w.]+)"],
    "jvm": [r"^\s*import\s+(?:static\s+)?([\w.]+)"],
    "kt": [r"^\s*import\s+([\w.]+)"],
    "cs": [r"^\s*using\s+(?:static\s+)?([\w.]+)\s*;"],
    "go": [r'^\s*(?:import\s+)?(?:[\w.]+\s+)?"([\w.\-/]+/[\w.\-/]+)"\s*$'],
    "rb": [r"""^\s*require(?:_relative)?\s*\(?\s*['"]([^'"]+)['"]"""],
    "php": [r"^\s*use\s+([\w\\]+)"],
    "rs": [r"^\s*(?:pub\s+)?use\s+((?:crate|super|self)(?:::\w+)+)"],
    "ex": [r"^\s*(?:alias|import|use)\s+([\w.]+)"],
    "dart": [r"""^\s*import\s+['"]([^'"]+)['"]"""],
}
IMPORTS = {k: [re.compile(p, re.M) for p in v] for k, v in IMPORTS.items()}

# (group, regex): "type" opens a declaration, "method" belongs to the last type, "func" stands alone.
DECLS = {
    "ts": [("type", r"^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(class|interface|enum|type)\s+([A-Z]\w*)"),
           ("func", r"^\s*export\s+(?:default\s+)?(?:async\s+)?(function)\s*\*?\s*(\w+)"),
           ("func", r"^\s*export\s+(const)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function|\w+\s*=>)"),
           ("method", r"^\s{2,4}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+)*(?!if\b|for\b|while\b|switch\b|return\b|catch\b|constructor\b)()([a-z]\w*)\s*\([^)]*\)\s*(?::\s*[^={]+)?\{\s*$")],
    "py": [("type", r"^(class)\s+(\w+)"), ("func", r"^(def|async def)\s+(\w+)"), ("method", r"^\s{4}()(?:async\s+)?def\s+([a-z]\w*)")],
    "jvm": [("type", r"^\s*(?:[\w@]+(?:\([^)]*\))?\s+)*(class|interface|enum|record|object|trait|struct)\s+([A-Z]\w*)"),
            ("method", r"^\s+(?:public|protected|internal)\s+(?:static\s+|final\s+|override\s+|abstract\s+|async\s+)*[\w<>\[\],.?\s]+?\s()(\w+)\s*\(")],
    "kt": [("type", r"^\s*(?:[\w@]+(?:\([^)]*\))?\s+)*(class|interface|object)\s+([A-Z]\w*)"),
           ("method", r"^\s+(?:override\s+|suspend\s+|public\s+|internal\s+)*()fun\s+(?:<[^>]*>\s*)?(\w+)"),
           ("func", r"^()fun\s+(?:<[^>]*>\s*)?(\w+)")],
    "cs": [("type", r"^\s*(?:[\w\[\]@]+(?:\([^)]*\))?\s+)*(class|interface|enum|record|struct)\s+([A-Z]\w*)"),
           ("method", r"^\s+(?:public|protected|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+|abstract\s+)*[\w<>\[\],.?\s]+?\s()([A-Z]\w*)\s*\(")],
    "go": [("type", r"^type\s+([A-Z]\w*)\s+(struct|interface)"), ("method", r"^func\s+\(\w*\s*\*?(\w+)\)\s+(\w+)"),
           ("func", r"^()func\s+(\w+)")],
    "rb": [("type", r"^\s*(class|module)\s+([A-Z][\w:]*)"), ("method", r"^\s+()def\s+((?:self\.)?\w+[?!]?)")],
    "php": [("type", r"^\s*(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+([A-Z]\w*)"),
            ("method", r"^\s+(?:public|protected)\s+(?:static\s+)?()function\s+(\w+)")],
    "rs": [("type", r"^\s*(?:pub(?:\([^)]*\))?\s+)?(struct|enum|trait)\s+([A-Z]\w*)"),
           ("method", r"^\s+(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?()fn\s+(\w+)"), ("func", r"^(?:pub\s+)?(?:async\s+)?()fn\s+(\w+)")],
    "ex": [("type", r"^\s*(defmodule)\s+([\w.]+)"), ("method", r"^\s+()def\s+(\w+[?!]?)")],
    "dart": [("type", r"^\s*(?:abstract\s+)?(class|enum|mixin)\s+([A-Z]\w*)")],
}
DECLS = {k: [(g, re.compile(p)) for g, p in v] for k, v in DECLS.items()}

SIGNALS = [
    ("orm", r"@Entity\b|@Table\b|@Document\b|models\.Model\b|__tablename__|ApplicationRecord|ActiveRecord::Base|\b(?:pg|mysql|sqlite)Table\(|new\s+Schema\(|\bschema\s+\"\w+\"\s+do|DbSet<|gorm\.Model|\bModel\.init\(|extends\s+Model\b|sequelize\.define\(|@Column\b"),
    ("aggregate", r"\bAggregateRoot\b|@Aggregate\b|\bAggregate\b"),
    ("value-object", r"\bValueObject\b|@Embeddable\b|@ValueObject\b|@dataclass\(frozen=True\)|Object\.freeze\("),
    ("event", r"\b[A-Z]\w*(?:Event|Happened|Occurred)\b|@EventHandler|@Subscribe\b|@OnEvent|\bDomainEvent\b|\.emit\(|\.publish\("),
    ("command", r"\b[A-Z]\w*Command\b|@CommandHandler|\bUseCase\b|\bInteractor\b"),
    ("repository", r"\b[A-Z]\w*Repository\b|@Repository\b"),
    ("route", r"@(?:Get|Post|Put|Patch|Delete|RequestMapping|GetMapping|PostMapping|RestController|Controller)\b|\b(?:router|app|server)\.(?:get|post|put|patch|delete)\(|export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\b|@app\.route|\bRoute::|\bprocedure\b|\bmutation\b"),
    ("http-client", r"\bfetch\(|\baxios\b|HttpClient\b|RestTemplate|WebClient\b|requests\.(?:get|post)|http\.(?:Get|Post)\(|Faraday|Guzzle"),
    ("queue", r"(?i)\b(?:kafka|rabbitmq|amqp|sqs|sns|pubsub|nats|bullmq|celery|sidekiq|inngest|temporal)\b|@KafkaListener|@RabbitListener"),
]
SIGNALS = [(n, re.compile(p)) for n, p in SIGNALS]

# Explicit DDD vocabulary in code; ORM entities and *Repository classes alone do not count.
DDD_MARK = re.compile(r"\bAggregateRoot\b|@Aggregate\b|\bValueObject\b|@ValueObject\b|@Embeddable\b|\bDomainEvent\b|"
                      r"\bBoundedContext\b|@AggregateIdentifier\b|\bAnti-?[Cc]orruption|\bUbiquitous")
DOMAIN_DIRS = {"domain", "aggregates", "aggregate", "value-objects", "valueobjects", "value_objects", "bounded-contexts",
               "bounded_contexts", "boundedcontexts"}

SCHEMA = [
    ("prisma", re.compile(r"^\s*model\s+(\w+)\s*\{", re.M), {".prisma"}),
    ("sql", re.compile(r"(?i)create\s+table\s+(?:if\s+not\s+exists\s+)?[`\"\[]?(?:\w+[`\"\]]?\.)?[`\"\[]?(\w+)"), {".sql"}),
    ("django", re.compile(r"^class\s+(\w+)\((?:[\w.]*\.)?Model\)", re.M), {".py"}),
    ("sqlalchemy", re.compile(r"__tablename__\s*=\s*['\"](\w+)"), {".py"}),
    ("rails", re.compile(r"^\s*class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)", re.M), {".rb"}),
    ("rails", re.compile(r"create_table\s+[:\"'](\w+)"), {".rb"}),
    ("drizzle", re.compile(r"\b(?:pg|mysql|sqlite)Table\(\s*['\"](\w+)"), {".ts", ".js"}),
    ("mongoose", re.compile(r"\bmodel\(\s*['\"](\w+)['\"]"), {".ts", ".js"}),
    ("sequelize", re.compile(r"\.define\(\s*['\"](\w+)['\"]"), {".ts", ".js"}),
    ("laravel", re.compile(r"Schema::create\(\s*['\"](\w+)"), {".php"}),
    ("ecto", re.compile(r"\bschema\s+\"(\w+)\"\s+do"), {".ex"}),
    ("ef", re.compile(r"\bDbSet<(\w+)>"), {".cs"}),
    ("knex", re.compile(r"createTable\(\s*['\"](\w+)"), {".ts", ".js"}),
]
ANNOTATED = re.compile(r"^\s*@(Entity|Table|Document|Embeddable|MappedSuperclass)\b")
CLASS_NAME = re.compile(r"\b(?:class|record)\s+([A-Z]\w*)")

STOP_WORDS = set("""service services controller controllers props dto dtos impl repository repositories handler handlers
test tests type types interface base abstract default config configuration options module modules provider providers
factory util utils helper helpers manager response request input output args params param data info item items list
get set create update delete use with by for to from of and or the a an new is has page view component components
store state context hook hooks error errors exception result results event events command query mapper schema model
models entity entities api client server app main index core common shared spec mock const value values key id ids
""".split())
PATTERNS = {"OHS", "PL", "ACL", "CF", "CS", "SK", "P", "SW"}
SYMMETRIC = {"SK", "P", "SW"}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REF_RE = re.compile(r"^(.+?)(?::(\d+)(?:-(\d+))?)?$")


def run(*args, cwd=None, timeout=120):
    try:
        out = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, errors="replace")
        return out.stdout if out.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def repo_root():
    top = run("git", "rev-parse", "--show-toplevel")
    return Path(top.strip()) if top else Path.cwd()


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "root"


def workspace(root, scope):
    common = run("git", "rev-parse", "--git-common-dir", cwd=root)
    base = (root / common.strip()).resolve() / "ddd-map" if common else root / ".ddd-map"
    name = slug("+".join(sorted(scope))) if scope else "root"
    if len(name) > 48:
        name = f"{name[:36].rstrip('-')}-{hashlib.sha1(name.encode()).hexdigest()[:8]}"
    ws = base / name
    ws.mkdir(parents=True, exist_ok=True)
    return ws


def kloc(n):
    return f"{n / 1000:.1f}k" if n >= 1000 else str(n)


def camel_words(name):
    return [w.lower() for w in re.findall(r"[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+", name)]


# ---------------------------------------------------------------- scan


def list_files(root, scope):
    out = run("git", "ls-files", "-co", "--exclude-standard", "--", *(scope or ["."]), cwd=root)
    if out is not None:
        return sorted(p for p in out.splitlines() if p)
    files = []
    for base in scope or ["."]:
        for d, dirs, names in os.walk(root / base):
            dirs[:] = [x for x in dirs if x not in SKIP_DIRS and not x.startswith(".")]
            files += [os.path.relpath(os.path.join(d, n), root) for n in names]
    return sorted(files)


def tag_of(path, head):
    parts = path.split("/")
    name = parts[-1]
    if any(p in SKIP_DIRS for p in parts[:-1]) or GENERATED_FILE.search(name) or GENERATED_MARK.search(head):
        return "generated"
    if any(p in TEST_DIRS for p in parts[:-1]) or TEST_FILE.search(name):
        return "test"
    if any(p in MIGRATION_DIRS for p in parts[:-1]) or "/".join(parts[-3:-1]) in MIGRATION_DIRS:
        return "migration"
    return None


def read_text(path):
    try:
        if path.stat().st_size > 2_000_000:
            return None
        return path.read_text(errors="replace")
    except OSError:
        return None


class Resolver:
    """Maps an import string to a file or directory of the repo: relative paths
    first, then workspace package names, then a unique path suffix."""

    def __init__(self, paths, packages):
        self.packages = sorted(packages.items(), key=lambda kv: -len(kv[0]))
        self.exact = {}
        self.suffix = defaultdict(set)
        self.dirs = set()
        for p in paths:
            stem = re.sub(r"\.\w+$", "", p)
            keys = [stem]
            if stem.rsplit("/", 1)[-1] in ("index", "__init__", "mod", "main"):
                keys.append(stem.rsplit("/", 1)[0] if "/" in stem else ".")
            for key in keys:
                self.exact.setdefault(key, p)
                segs = key.split("/")
                for i in range(len(segs) - 1):
                    self.suffix["/".join(segs[i:])].add(p)
            d = p.rsplit("/", 1)[0] if "/" in p else "."
            while d not in self.dirs:
                self.dirs.add(d)
                segs = d.split("/")
                for i in range(len(segs) - 1):
                    self.suffix["/".join(segs[i:])].add(d + "/")
                if "/" not in d:
                    break
                d = d.rsplit("/", 1)[0]

    def lookup(self, key):
        key = os.path.normpath(key).replace("\\", "/")
        if key in self.exact:
            return self.exact[key]
        if key in self.dirs:
            return key + "/"
        return None

    def resolve(self, src, spec, lang):
        here = src.rsplit("/", 1)[0] if "/" in src else "."
        if lang == "py" and spec.startswith("."):
            level = len(spec) - len(spec.lstrip("."))
            base = here
            for _ in range(level - 1):
                base = base.rsplit("/", 1)[0] if "/" in base else "."
            rest = spec.lstrip(".").replace(".", "/")
            return self.lookup(f"{base}/{rest}" if rest else base)
        if spec.startswith("./") or spec.startswith("../"):
            return self.lookup(f"{here}/{spec}")
        if lang == "rs" and spec.startswith("super::"):
            return self.lookup(f"{here}/../{spec[7:].replace('::', '/')}") or self.lookup(f"{here}/../{spec[7:].rsplit('::', 1)[0].replace('::', '/')}")
        if lang == "rb" and not spec.startswith("/") and "/" in spec:
            hit = self.lookup(f"{here}/{spec}")
            if hit:
                return hit
        for name, d in self.packages:
            if spec == name or spec.startswith(name + "/"):
                return self.lookup(d + spec[len(name):]) or (d + "/")
        norm = spec
        if lang in ("py", "jvm", "kt", "cs", "ex"):
            norm = spec.replace(".", "/")
        elif lang == "php":
            norm = spec.replace("\\", "/")
        elif lang == "rs":
            norm = spec.replace("::", "/").removeprefix("crate/").removeprefix("self/")
        norm = re.sub(r"^(?:@/|~/|#/?|\$lib/)", "", norm).strip("/").removesuffix("/*")
        segs = norm.split("/")
        if len(segs) < 2 and lang == "ts":
            return None
        for i in range(len(segs) - 1 if len(segs) > 1 else 1):
            hits = self.suffix.get("/".join(segs[i:]))
            if hits:
                return next(iter(hits)) if len(hits) == 1 else self._common(hits)
        return None

    @staticmethod
    def _common(hits):
        # Several candidates: accept only when they share one directory.
        dirs = {h.rstrip("/").rsplit("/", 1)[0] for h in hits}
        return (dirs.pop() + "/") if len(dirs) == 1 else None


def build_tree(files):
    root = {"path": "", "files": [], "dirs": {}, "loc": 0}
    for f in files:
        node = root
        node["loc"] += f["loc"]
        parts = f["path"].split("/")
        for i, part in enumerate(parts[:-1]):
            node = node["dirs"].setdefault(part, {"path": "/".join(parts[: i + 1]), "files": [], "dirs": {}, "loc": 0})
            node["loc"] += f["loc"]
        node["files"].append(f)
    return root


def all_files(node):
    out = list(node["files"])
    for child in sorted(node["dirs"]):
        out += all_files(node["dirs"][child])
    return out


def make_units(node, umax, out):
    label = node["path"] or "."
    if node["loc"] <= umax or not node["dirs"]:
        out.append({"id": label, "files": [f["path"] for f in all_files(node)], "loc": node["loc"]})
        return
    if node["files"]:
        out.append({"id": f"{label}/*", "files": [f["path"] for f in node["files"]], "loc": sum(f["loc"] for f in node["files"])})
    for child in sorted(node["dirs"]):
        make_units(node["dirs"][child], umax, out)


def make_slices(node, smax):
    label = node["path"] or "."
    if node["loc"] <= smax:
        return [{"paths": [label], "files": [f["path"] for f in all_files(node)], "loc": node["loc"]}]
    items = []
    chunk = {"paths": [f"{label}/*"], "files": [], "loc": 0}
    for f in node["files"]:
        if chunk["files"] and chunk["loc"] + f["loc"] > smax:
            items.append(chunk)
            chunk = {"paths": [f"{label}/*"], "files": [], "loc": 0}
        chunk["files"].append(f["path"])
        chunk["loc"] += f["loc"]
    if chunk["files"]:
        items.append(chunk)
    for child in sorted(node["dirs"]):
        items += make_slices(node["dirs"][child], smax)
    merged = []
    for item in items:
        if merged and merged[-1]["loc"] + item["loc"] <= smax:
            last = merged[-1]
            last["paths"] += item["paths"]
            last["files"] += item["files"]
            last["loc"] += item["loc"]
        else:
            merged.append(item)
    return merged


def louvain(adj):
    """Community detection on an undirected weighted graph {node: {nbr: w}}."""
    membership = {n: n for n in adj}
    level = adj
    while True:
        comm, improved = _louvain_level(level)
        if not improved:
            return membership
        membership = {n: comm[c] for n, c in membership.items()}
        nxt = defaultdict(lambda: defaultdict(float))
        for n, nbrs in level.items():
            nxt[comm[n]]  # keep communities without edges
            for m, w in nbrs.items():
                nxt[comm[n]][comm[m]] += w
        level = {a: dict(b) for a, b in nxt.items()}


def _louvain_level(adj):
    m2 = sum(sum(n.values()) for n in adj.values())
    comm = {n: n for n in adj}
    if not m2:
        return comm, False
    k = {n: sum(nbrs.values()) for n, nbrs in adj.items()}
    tot = dict(k)
    improved, moved = False, True
    while moved:
        moved = False
        for n in sorted(adj):
            c0 = comm[n]
            links = defaultdict(float)
            for m, w in adj[n].items():
                if m != n:
                    links[comm[m]] += w
            tot[c0] -= k[n]
            best, best_gain = c0, links.get(c0, 0) - tot[c0] * k[n] / m2
            for c, w in sorted(links.items()):
                gain = w - tot[c] * k[n] / m2
                if gain > best_gain + 1e-9:
                    best, best_gain = c, gain
            tot[best] += k[n]
            if best != c0:
                comm[n] = best
                moved = improved = True
    return comm, improved


def codeowners(root):
    for rel in (".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS", ".gitlab/CODEOWNERS"):
        text = read_text(root / rel)
        if text is None:
            continue
        rules = []
        for line in text.splitlines():
            line = line.split("#", 1)[0].strip()
            if not line or line.startswith("["):
                continue
            pattern, *owners = line.split()
            anchored = pattern.startswith("/") or "/" in pattern.rstrip("/")
            pat = pattern.strip("/")
            rx = re.escape(pat).replace(r"\*\*", ".*").replace(r"\*", "[^/]*").replace(r"\?", "[^/]")
            rx = ("^" if anchored else r"(^|.*/)") + rx + r"(/.*)?$"
            rules.append((re.compile(rx), owners))
        return rules
    return []


def owners_of(rules, path):
    found = []
    for rx, owners in rules:
        if rx.match(path):
            found = owners
    return found


def remote_link(root):
    url = (run("git", "remote", "get-url", "origin", cwd=root) or "").strip()
    sha = (run("git", "rev-parse", "HEAD", cwd=root) or "").strip()
    m = re.match(r"^(?:git@|ssh://git@|https?://(?:[^@/]+@)?)([^:/]+)[:/](.+?)(?:\.git)?/?$", url)
    if not (m and sha):
        return None
    host, repo = m.groups()
    if "gitlab" in host:
        return {"base": f"https://{host}/{repo}/-/blob/{sha}/", "line": "#L{a}", "range": "#L{a}-{b}", "sha": sha}
    if "bitbucket" in host:
        return {"base": f"https://{host}/{repo}/src/{sha}/", "line": "#lines-{a}", "range": "#lines-{a}:{b}", "sha": sha}
    return {"base": f"https://{host}/{repo}/blob/{sha}/", "line": "#L{a}", "range": "#L{a}-L{b}", "sha": sha}


def churn(root, scope, since):
    out = run("git", "log", f"--since={since}", "--no-merges", "--format=@@%an", "--name-only", "--", *(scope or ["."]),
              cwd=root, timeout=180)
    commits, authors = Counter(), defaultdict(set)
    if not out:
        return commits, authors
    author = None
    for line in out.splitlines():
        if line.startswith("@@"):
            author = line[2:]
        elif line:
            commits[line] += 1
            authors[line].add(author)
    return commits, authors


def cmd_scan(args):
    root = repo_root()
    scope = [s.strip("/") for s in args.scope]
    ws = workspace(root, scope)
    paths = list_files(root, scope)
    files, schema, docs, manifests, packages = [], [], [], [], {}
    for p in paths:
        ext = os.path.splitext(p)[1].lower()
        name = p.rsplit("/", 1)[-1]
        if name in MANIFESTS or name.endswith(".csproj") or re.match(r"docker-compose.*\.ya?ml$|compose\.ya?ml$", name):
            if not any(d in SKIP_DIRS for d in p.split("/")[:-1]):
                manifests.append(p)
                if name == "package.json":
                    try:
                        pkg = json.loads(read_text(root / p) or "{}").get("name")
                        if pkg:
                            packages[pkg] = p.rsplit("/", 1)[0] if "/" in p else "."
                    except ValueError:
                        pass
        if ext in (".md", ".mdx", ".adoc", ".rst") or re.search(r"(openapi|swagger|asyncapi)[^/]*\.(ya?ml|json)$", name, re.I):
            if not any(d in SKIP_DIRS for d in p.split("/")[:-1]) and "changelog" not in name.lower():
                docs.append(p)
        if ext not in LANG and ext not in SCHEMA_EXT:
            continue
        text = read_text(root / p)
        if text is None:
            continue
        tag = tag_of(p, text[:600])
        lines = text.splitlines()
        rec = {"path": p, "lang": LANG.get(ext), "loc": sum(1 for line in lines if line.strip()), "tag": tag,
               "sha": hashlib.sha1(text.encode()).hexdigest()[:12]}
        if tag != "generated":
            for kind, rx, exts in SCHEMA:
                if ext in exts:
                    for m in rx.finditer(text):
                        schema.append({"name": m.group(1), "kind": kind, "ref": f"{p}:{text.count(chr(10), 0, m.start()) + 1}"})
            pending = None
            for i, line in enumerate(lines[:4000]):
                if ANNOTATED.match(line):
                    pending = pending or (i, ANNOTATED.match(line).group(1))
                elif pending and i - pending[0] <= 6:
                    m = CLASS_NAME.search(line)
                    if m:
                        schema.append({"name": m.group(1), "kind": f"@{pending[1]}", "ref": f"{p}:{i + 1}"})
                        pending = None
                else:
                    pending = None
        if rec["lang"] and not tag:
            rec["signals"] = sorted({n for n, rx in SIGNALS if rx.search(text)} | ({"ui"} if ext in UI_EXT else set()))
            rec["types"] = types_of(rec["lang"], lines)
            if DDD_MARK.search(text):
                rec["ddd"] = True
            rec["imports"] = sorted({m.group(1) for rx in IMPORTS.get(rec["lang"], []) for m in rx.finditer(text)})
        files.append(rec)

    source = [f for f in files if f["lang"] and not f["tag"]]
    tree = build_tree(source)
    units = []
    make_units(tree, args.unit_max, units)
    unit_of = {p: u["id"] for u in units for p in u["files"]}
    first_in_dir = {}
    for f in source:
        d = f["path"]
        while "/" in d:
            d = d.rsplit("/", 1)[0]
            first_in_dir.setdefault(d, f["path"])
        first_in_dir.setdefault(".", f["path"])

    # Import graph between units.
    resolver = Resolver([f["path"] for f in source], packages)
    edges = Counter()
    resolved = total = 0
    for f in source:
        for spec in f.pop("imports", []):
            total += 1
            hit = resolver.resolve(f["path"], spec, f["lang"])
            if not hit:
                continue
            target = unit_of.get(hit) if not hit.endswith("/") else unit_of.get(first_in_dir.get(hit.rstrip("/") or ".", ""))
            if target:
                resolved += 1
                if target != unit_of[f["path"]]:
                    edges[(unit_of[f["path"]], target)] += 1

    adj = {u["id"]: {} for u in units}
    for (a, b), w in edges.items():
        adj[a][b] = adj[a].get(b, 0) + w
        adj[b][a] = adj[b].get(a, 0) + w
    membership = louvain(adj)
    clusters = defaultdict(list)
    for u in units:
        clusters[membership[u["id"]]].append(u["id"])
    loc_of = {u["id"]: u["loc"] for u in units}
    cluster_list = sorted((sorted(v) for v in clusters.values() if len(v) > 1), key=lambda v: -sum(loc_of[x] for x in v))

    commits, authors = churn(root, scope, args.since)
    rules = codeowners(root)
    by_path = {f["path"]: f for f in files}
    for u in units:
        words = Counter(w for p in u["files"] for t in by_path[p].get("types", []) for w in camel_words(t)
                        if w not in STOP_WORDS and len(w) > 2)
        u["vocabulary"] = [w for w, _ in words.most_common(8)]
        u["signals"] = dict(Counter(s for p in u["files"] for s in by_path[p].get("signals", [])))
        u["commits"] = sum(commits.get(p, 0) for p in u["files"])
        u["authors"] = len(set().union(*(authors.get(p, set()) for p in u["files"]))) if u["files"] else 0
        if rules:
            u["owners"] = sorted({o for p in u["files"][:50] for o in owners_of(rules, p)})

    fit = ddd_fit(source)
    slices = make_slices(tree, args.slice_max)
    for i, s in enumerate(slices, 1):
        s["id"] = f"s{i:02d}"
        s["hash"] = hashlib.sha1("".join(f"{p}:{by_path[p]['sha']}\n" for p in sorted(s["files"])).encode()).hexdigest()[:12]
        s["note"] = f"notes/{s['hash']}.json"
        s["units"] = sorted({unit_of[p] for p in s["files"]})
    slice_of_unit = {u: s["id"] for s in slices for u in s["units"]}
    slice_edges = Counter()
    for (a, b), w in edges.items():
        if slice_of_unit.get(a) != slice_of_unit.get(b):
            slice_edges[(slice_of_unit.get(a), slice_of_unit.get(b))] += w

    homonyms = defaultdict(set)
    for f in source:
        for t in f.get("types", []):
            if t.lower() not in STOP_WORDS and len(t) > 3:
                homonyms[t].add(unit_of[f["path"]])
    homonyms = sorted(((t, sorted(us)) for t, us in homonyms.items() if len(us) > 1), key=lambda x: (-len(x[1]), x[0]))

    inventory = {
        "version": 1, "root": str(root), "scope": scope, "date": date.today().isoformat(),
        "link": remote_link(root), "packages": packages, "manifests": manifests, "docs": docs,
        "files": [{k: v for k, v in f.items() if k != "types"} | {"types": f.get("types", [])[:40]} for f in files],
        "units": units, "edges": [[a, b, w] for (a, b), w in edges.most_common()], "clusters": cluster_list,
        "slices": slices, "sliceEdges": [[a, b, w] for (a, b), w in slice_edges.most_common()],
        "schema": schema, "homonyms": homonyms[:200], "imports": {"total": total, "resolved": resolved},
        "params": {"unitMax": args.unit_max, "sliceMax": args.slice_max, "since": args.since}, "fit": fit,
    }
    (ws / "inventory.json").write_text(json.dumps(inventory))
    (ws / "notes").mkdir(exist_ok=True)
    (ws / "areas").mkdir(exist_ok=True)
    print_overview(root, ws, inventory)


def types_of(lang, lines):
    out = []
    for g, rx in DECLS.get(lang, []):
        if g != "type":
            continue
        for line in lines:
            m = rx.match(line)
            if m:
                out.append(m.group(1) if lang == "go" else m.group(2))
    return out


def ddd_fit(source):
    """Does the code carry a domain model worth mapping? `ddd`: explicit DDD;
    `partial`: some of it, the rest will be inferred; `none`: nothing to read a model from."""
    total = sum(f["loc"] for f in source) or 1
    marked = [f["path"] for f in source if f.get("ddd")]
    dirs, domain_loc = set(), 0
    for f in source:
        parts = f["path"].split("/")[:-1]
        hit = next((i for i, p in enumerate(parts) if p.lower() in DOMAIN_DIRS), None)
        if hit is not None:
            dirs.add("/".join(parts[: hit + 1]))
            domain_loc += f["loc"]
    signals = Counter(s for f in source for s in f.get("signals", []))
    strong = len(marked) >= max(5, len(source) * 0.005) or (len(dirs) >= 2 and domain_loc >= total * 0.05)
    verdict = "ddd" if strong else "partial" if len(marked) >= 2 or dirs else "none"
    return {
        "verdict": verdict, "markedFiles": len(marked), "markedExamples": marked[:5], "domainDirs": sorted(dirs)[:12],
        "domainDirCount": len(dirs), "domainShare": round(domain_loc / total, 3),
        "signals": {k: signals.get(k, 0) for k in ("orm", "repository", "command", "event", "route", "ui")},
    }


def print_fit(fit):
    words = {"ddd": "explicit DDD in the code",
             "partial": "some DDD in the code; most of the model would be inferred",
             "none": "no DDD in the code: a map would be invented, not read"}
    print(f"DDD fit    {fit['verdict']}: {words[fit['verdict']]}")
    print(f"           {fit['markedFiles']} files use DDD vocabulary (aggregate root, value object, domain event…)"
          + (f", e.g. {', '.join(fit['markedExamples'][:3])}" if fit["markedExamples"] else ""))
    print(f"           {fit['domainDirCount']} domain folders holding {fit['domainShare']:.0%} of the code"
          + (f": {', '.join(fit['domainDirs'][:5])}" if fit["domainDirs"] else ""))
    sig = fit["signals"]
    print(f"           files with ORM models {sig['orm']}, repositories {sig['repository']}, commands {sig['command']}, "
          f"events {sig['event']}, routes {sig['route']}, UI {sig['ui']}")


def print_overview(root, ws, inv):
    files = inv["files"]
    source = [f for f in files if f["lang"] and not f["tag"]]
    tags = Counter(f["tag"] or ("source" if f["lang"] else "schema") for f in files)
    langs = Counter()
    for f in source:
        langs[f["lang"]] += f["loc"]
    total = sum(f["loc"] for f in source)
    print(f"repo       {root}{'  (scope: ' + ', '.join(inv['scope']) + ')' if inv['scope'] else ''}")
    print(f"workspace  {ws}")
    print(f"source     {kloc(total)} LoC in {len(source)} files ({', '.join(f'{k} {kloc(v)}' for k, v in langs.most_common())})")
    print(f"set aside  " + ", ".join(f"{n} {k}" for k, n in tags.items() if k != "source") + "  (not part of slices)")
    print_fit(inv["fit"])
    imp = inv["imports"]
    print(f"imports    {imp['resolved']}/{imp['total']} resolved inside the repo"
          + ("  (low: clusters and dependencies below are weak evidence)" if imp["total"] and imp["resolved"] < imp["total"] * 0.15 else ""))
    if inv["link"]:
        print(f"links      {inv['link']['base']}")
    url = ws / "url.txt"
    if url.exists():
        print(f"previous map URL  {url.read_text().strip()}")
    print(f"\nmanifests ({len(inv['manifests'])}): " + ", ".join(inv["manifests"][:60]) + (" …" if len(inv["manifests"]) > 60 else ""))
    print(f"docs ({len(inv['docs'])}): " + ", ".join(sorted(inv["docs"], key=lambda d: (d.count("/"), d))[:50]) + (" …" if len(inv["docs"]) > 50 else ""))
    kinds = Counter(s["kind"] for s in inv["schema"])
    names = sorted({s["name"] for s in inv["schema"]})
    print(f"schema ({len(names)} tables/models; {', '.join(f'{k} {n}' for k, n in kinds.most_common())}): "
          + ", ".join(names[:120]) + (" …" if len(names) > 120 else ""))

    print(f"\nunits ({len(inv['units'])}): LoC, commits since {inv['params']['since']}, authors, signals, vocabulary")
    for u in inv["units"]:
        sig = " ".join(f"{k}:{v}" for k, v in sorted(u["signals"].items(), key=lambda kv: -kv[1])[:6])
        owners = f"  owners {' '.join(u['owners'])}" if u.get("owners") else ""
        print(f"  {u['id']:<48} {kloc(u['loc']):>6} {u['commits']:>5}c {u['authors']:>3}a  {sig}  | {', '.join(u['vocabulary'])}{owners}")

    if inv["clusters"]:
        print("\nimport clusters (units that import each other more than the rest):")
        for c in inv["clusters"][:30]:
            print(f"  - {', '.join(c[:12])}{' …' if len(c) > 12 else ''}")
    if inv["homonyms"]:
        print("\nsame type name in several units (candidate homonyms or shared kernel):")
        print("  " + "; ".join(f"{t} ({len(us)})" for t, us in inv["homonyms"][:60]))

    done = sum((ws / s["note"]).exists() for s in inv["slices"])
    print(f"\nslices ({len(inv['slices'])}, ≤ {kloc(inv['params']['sliceMax'])} LoC each; {done} already have notes):")
    for s in inv["slices"]:
        state = "done" if (ws / s["note"]).exists() else "todo"
        print(f"  {s['id']}  {kloc(s['loc']):>6}  {len(s['files']):>4} files  {state}  {', '.join(s['paths'][:6])}{' …' if len(s['paths']) > 6 else ''}")


# ---------------------------------------------------------------- outline / status / notes


def load_ws(scope):
    root = repo_root()
    ws = workspace(root, [s.strip("/") for s in scope])
    inv_path = ws / "inventory.json"
    if not inv_path.exists():
        sys.exit(f"No inventory in {ws}; run `scan` first (with the same --scope).")
    return root, ws, json.loads(inv_path.read_text())


def cmd_outline(args):
    root, ws, inv = load_ws(args.scope)
    if args.slice:
        sl = next((s for s in inv["slices"] if s["id"] == args.slice), None)
        if not sl:
            sys.exit(f"No slice {args.slice}")
        paths = sl["files"]
        print(f"{sl['id']}: {kloc(sl['loc'])} LoC in {len(paths)} files — {', '.join(sl['paths'])}")
    else:
        prefix = args.path.strip("/")
        paths = [f["path"] for f in inv["files"] if f["lang"] and not f["tag"] and (f["path"] == prefix or f["path"].startswith(prefix + "/"))]
    by_path = {f["path"]: f for f in inv["files"]}
    tests = [f["path"] for f in inv["files"] if f["tag"] == "test"]
    for p in paths:
        f = by_path[p]
        text = read_text(root / p) or ""
        lines = text.splitlines()
        sig = f" [{', '.join(f.get('signals', []))}]" if f.get("signals") else ""
        print(f"\n{p}  ({f['loc']} LoC){sig}")
        current = None
        methods = []

        def flush():
            if current and methods:
                more = f" (+{len(methods) - 14})" if len(methods) > 14 else ""
                print(f"      · {', '.join(methods[:14])}{more}")

        for i, line in enumerate(lines, 1):
            for g, rx in DECLS.get(f["lang"], []):
                m = rx.match(line)
                if not m:
                    continue
                if g == "type":
                    flush()
                    kind, name = (m.group(2), m.group(1)) if f["lang"] == "go" else (m.group(1), m.group(2))
                    current, methods = name, []
                    print(f"  L{i:<5} {kind} {name}")
                elif g == "method" and current:
                    methods.append(m.group(2))
                elif g == "func":
                    flush()
                    current, methods = None, []
                    print(f"  L{i:<5} fn {m.group(2)}")
                break
        flush()
        stem = re.sub(r"\.\w+$", "", p.rsplit("/", 1)[-1])
        near = [t for t in tests if stem in t.rsplit("/", 1)[-1]][:3]
        if near:
            print(f"  tests: {', '.join(near)}")


def note_problems(root, inv, ws, sl):
    path = ws / sl["note"]
    if not path.exists():
        return ["missing"]
    try:
        note = json.loads(path.read_text())
    except ValueError as e:
        return [f"not valid JSON: {e}"]
    problems = []
    if note.get("slice") != sl["id"] and note.get("hash") != sl["hash"]:
        problems.append(f"`slice` should be {sl['id']}")
    for key in ("summary", "role"):
        if not str(note.get(key, "")).strip():
            problems.append(f"`{key}` is empty")
    for key in ("concepts", "terms", "integrations"):
        if not isinstance(note.get(key, []), list):
            problems.append(f"`{key}` must be a list")
    kinds = {"aggregate", "entity", "value-object", "domain-event", "command", "query", "use-case", "domain-service",
             "policy", "repository", "factory", "read-model", "saga", "external-system", "enum"}
    for c in note.get("concepts", []):
        if c.get("kind") not in kinds:
            problems.append(f"concept {c.get('name')}: kind `{c.get('kind')}` not one of {', '.join(sorted(kinds))}")
    refs = [c.get("code") for c in note.get("concepts", [])] + [i.get("code") for i in note.get("integrations", [])]
    refs += [t.get("code") for t in note.get("terms", [])]
    for ref in refs:
        if ref:
            err = ref_problem(root, ref)
            if err:
                problems.append(err)
    return problems


_line_counts = {}


def ref_problem(root, ref):
    m = REF_RE.match(str(ref).strip())
    if not m:
        return f"bad code reference `{ref}`"
    path, a, b = m.group(1), m.group(2), m.group(3)
    full = root / path
    if not full.exists():
        return f"`{ref}`: no such path"
    if a:
        if path not in _line_counts:
            _line_counts[path] = len((read_text(full) or "").splitlines()) if full.is_file() else 0
        n = _line_counts[path]
        if int(a) < 1 or int(a) > n or (b and (int(b) < int(a) or int(b) > n)):
            return f"`{ref}`: outside the file's {n} lines"
    return None


def cmd_status(args):
    root, ws, inv = load_ws(args.scope)
    todo = []
    for s in inv["slices"]:
        problems = note_problems(root, inv, ws, s) if args.check else (["missing"] if not (ws / s["note"]).exists() else [])
        state = "done" if not problems else ("todo" if problems == ["missing"] else "invalid")
        if problems:
            todo.append(s["id"])
        print(f"{s['id']}  {state:<7} {kloc(s['loc']):>6}  {ws / s['note']}  {', '.join(s['paths'][:4])}")
        for p in problems if problems != ["missing"] else []:
            print(f"        - {p}")
    print(f"\n{len(inv['slices']) - len(todo)}/{len(inv['slices'])} slices have valid notes" if args.check
          else f"\n{len(inv['slices']) - len(todo)}/{len(inv['slices'])} slices have notes")
    sys.exit(1 if todo and args.check else 0)


def cmd_digest(args):
    root, ws, inv = load_ws(args.scope)
    wanted = set(args.slices.split(",")) if args.slices else None
    if args.context:
        wanted = slices_for_context(inv, ws, args.context)
        print(f"slices touching context {args.context}: {', '.join(sorted(wanted)) or 'none'}")
    out = []
    names = defaultdict(list)
    terms = defaultdict(list)
    for s in inv["slices"]:
        path = ws / s["note"]
        if not path.exists():
            continue
        note = json.loads(path.read_text())
        for c in note.get("concepts", []):
            names[c.get("name")].append(s["id"])
        for t in note.get("terms", []):
            terms[t.get("term", "").lower()].append((s["id"], t.get("meaning", "")))
        if args.cross or (wanted and s["id"] not in wanted):
            continue
        out.append(f"\n## {s['id']}  {kloc(s['loc'])} LoC  {', '.join(s['paths'])}")
        out.append(f"role: {note.get('role')}   subdomains: {', '.join(note.get('subdomainHints', []))}")
        out.append(note.get("summary", "").strip())
        for h in note.get("contextHints", []):
            out.append(f"context? {h.get('name')}: {h.get('why', '')} [{', '.join(h.get('paths', []))}]")
        by_kind = defaultdict(list)
        for c in note.get("concepts", []):
            extra = f" ⊂{c['partOf']}" if c.get("partOf") and c["partOf"] != c.get("name") else ""
            by_kind[c.get("kind")].append(f"{c.get('name')}{extra}" + ("" if args.brief else f" @{c.get('code', '?')}"))
        for kind, items in by_kind.items():
            out.append(f"{kind}: " + "; ".join(items))
        if note.get("terms"):
            out.append("terms: " + "; ".join(t.get("term", "") if args.brief else f"{t.get('term')} = {t.get('meaning')}" for t in note["terms"]))
        for i in note.get("integrations", []):
            out.append(f"{i.get('direction', '?')} {i.get('kind')} → {i.get('target')}: {i.get('what', '')} @{i.get('code', '?')}")
        for t in note.get("tables", []):
            out.append(f"table {t.get('name')} ({t.get('access')})" + ("" if args.brief else f" @{t.get('code', '?')}"))
        for f in note.get("findings", []):
            out.append(f"finding: {f.get('title')}" + ("" if args.brief else f" — {f.get('text', '')} @{f.get('code', '?')}"))
        if note.get("skimmed"):
            out.append(f"skimmed: {len(note['skimmed'])} files")
    if not wanted:
        shared = sorted(((n, v) for n, v in names.items() if len(set(v)) > 1), key=lambda x: -len(set(x[1])))
        if shared:
            out.append("\n## concepts named in several slices")
            out.append("; ".join(f"{n} ({', '.join(sorted(set(v)))})" for n, v in shared[:150]))
        multi = [(t, v) for t, v in terms.items() if len({s for s, _ in v}) > 1]
        if multi:
            out.append("\n## terms defined in several slices (compare meanings)")
            for t, v in sorted(multi):
                out.append(f"{t}: " + " | ".join(f"{s}: {m}" for s, m in v))
        if inv["sliceEdges"]:
            out.append("\n## imports between slices (from → to: count)")
            out.append("; ".join(f"{a}→{b}:{w}" for a, b, w in inv["sliceEdges"][:200]))
    text = "\n".join(out)
    if not wanted and not args.cross:
        print(f"digest of {sum((ws / s['note']).exists() for s in inv['slices'])} slices, about {len(text) // 4 // 1000}k tokens"
              + ("" if args.brief else "; --brief drops code references and meanings"))
    print(text)


# ---------------------------------------------------------------- build


def checkers(root, problems):
    def need(obj, key, where):
        if not str(obj.get(key, "")).strip():
            problems.append(f"{where}: `{key}` is empty")

    def check_id(value, where):
        if not isinstance(value, str) or not ID_RE.match(value):
            problems.append(f"{where}: id `{value}` must be lowercase words joined by single hyphens")

    def check_ref(ref, where):
        err = ref_problem(root, ref) if ref else None
        if err:
            problems.append(f"{where}: {err}")

    return need, check_id, check_ref


def load_domain(model_dir):
    try:
        return json.loads((model_dir / "domain.json").read_text())
    except (OSError, ValueError) as e:
        sys.exit(f"Cannot read {model_dir / 'domain.json'}: {e}")


def cmd_check_context(args):
    """Validates one context file, so a modeler can finish its context alone."""
    root, ws, inv = load_ws(args.scope)
    model_dir = ws / "model"
    domain = load_domain(model_dir)
    contexts = {c.get("id"): c for c in domain.get("contexts", [])}
    if args.context not in contexts:
        sys.exit(f"No context `{args.context}` in domain.json")
    path = model_dir / "contexts" / f"{args.context}.json"
    try:
        d = json.loads(path.read_text())
    except (OSError, ValueError) as e:
        sys.exit(f"Cannot read {path}: {e}")
    problems = []
    need, check_id, check_ref = checkers(root, problems)
    check_context(d, args.context, contexts, check_id, check_ref, need, problems)
    if problems:
        print(f"{len(problems)} problem(s) in {path.name}:")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    members = sum(len(a.get("members", [])) for a in d.get("aggregates", []))
    print(f"{path.name} ok: {len(d.get('aggregates', []))} aggregates ({members} members), "
          f"{len(d.get('useCases', []))} use cases, {len(d.get('events', []))} events, {len(d.get('language', []))} terms")


def slices_for_context(inv, ws, cid):
    domain = load_domain(ws / "model")
    ctx = next((c for c in domain.get("contexts", []) if c.get("id") == cid), None)
    if not ctx:
        sys.exit(f"No context `{cid}` in domain.json")
    claims = [p.strip("/") for p in ctx.get("paths", [])]
    return {s["id"] for s in inv["slices"] if any(match_claim(f, c) for f in s["files"] for c in claims)}


def cmd_build(args):
    root, ws, inv = load_ws(args.scope)
    model_dir = Path(args.model) if args.model else ws / "model"
    problems, warnings = [], []
    domain = load_domain(model_dir)
    need, check_id, check_ref = checkers(root, problems)

    if domain.get("version") != 1:
        problems.append("domain.json: `version` must be 1")
    need(domain, "title", "domain.json")
    need(domain.get("domain", {}), "name", "domain")
    need(domain.get("domain", {}), "description", "domain")
    for src in domain.get("domain", {}).get("sources", []):
        if src.get("code"):
            check_ref(src["code"], "domain source")

    subdomains = {}
    for sd in domain.get("subdomains", []):
        check_id(sd.get("id"), f"subdomain {sd.get('name')}")
        if sd.get("id") in subdomains:
            problems.append(f"subdomain id `{sd['id']}` is used twice")
        subdomains[sd.get("id")] = sd
        need(sd, "name", f"subdomain {sd.get('id')}")
        need(sd, "description", f"subdomain {sd.get('id')}")
        if sd.get("type") not in ("core", "supporting", "generic"):
            problems.append(f"subdomain {sd.get('id')}: type must be core, supporting or generic")
    if not subdomains:
        problems.append("domain.json: no subdomains")

    contexts = {}
    used_subdomains = set()
    for c in domain.get("contexts", []):
        where = f"context {c.get('id')}"
        check_id(c.get("id"), where)
        if c.get("id") in contexts:
            problems.append(f"context id `{c['id']}` is used twice")
        contexts[c.get("id")] = c
        need(c, "name", where)
        need(c, "description", where)
        for sd in c.get("subdomains", []):
            used_subdomains.add(sd)
            if sd not in subdomains:
                problems.append(f"{where}: unknown subdomain `{sd}`")
        if not c.get("subdomains") and c.get("kind", "internal") == "internal":
            problems.append(f"{where}: lists no subdomain")
        if c.get("kind", "internal") not in ("internal", "external", "outside"):
            problems.append(f"{where}: kind must be internal, external or outside")
        if c.get("kind", "internal") == "internal" and not c.get("paths"):
            problems.append(f"{where}: an internal context needs `paths`")
        for p in c.get("paths", []):
            if not glob_like(p) and not (root / p.strip("/")).exists():
                problems.append(f"{where}: path `{p}` does not exist")
    for sd in subdomains:
        if sd not in used_subdomains:
            warnings.append(f"subdomain `{sd}` is implemented by no context")

    rels = []
    for i, r in enumerate(domain.get("relationships", [])):
        where = f"relationship {r.get('upstream')} → {r.get('downstream')}"
        for end in ("upstream", "downstream"):
            if r.get(end) not in contexts:
                problems.append(f"{where}: unknown context `{r.get(end)}`")
        bad = [p for p in r.get("patterns", []) if p not in PATTERNS]
        if bad:
            problems.append(f"{where}: unknown pattern(s) {', '.join(bad)}; use {', '.join(sorted(PATTERNS))}")
        need(r, "description", where)
        for ref in r.get("evidence", []):
            check_ref(ref, where)
        rels.append(r)

    # Tactical models, one file per internal context.
    details = {}
    for cid, c in contexts.items():
        path = model_dir / "contexts" / f"{cid}.json"
        if not path.exists():
            if c.get("kind", "internal") == "internal":
                problems.append(f"context {cid}: missing {path}")
            continue
        try:
            d = json.loads(path.read_text())
        except ValueError as e:
            problems.append(f"{path.name}: not valid JSON: {e}")
            continue
        details[cid] = d
        check_context(d, cid, contexts, check_id, check_ref, need, problems)

    # Every source file belongs to a context or is set aside with a reason.
    claims = []
    for cid, c in contexts.items():
        for p in c.get("paths", []):
            claims.append((p.strip("/"), cid))
    for u in domain.get("unassigned", []):
        need(u, "reason", f"unassigned {u.get('path')}")
        claims.append((str(u.get("path", "")).strip("/"), None))
    seen_claims = Counter(p for p, _ in claims)
    for p, n in seen_claims.items():
        if n > 1:
            problems.append(f"path `{p}` is claimed {n} times; give it to one context (a deeper path wins over a shallower one)")
    owner_of = {}
    uncovered = Counter()
    by_path = {f["path"]: f for f in inv["files"]}
    for f in inv["files"]:
        if not f["lang"] or f["tag"]:
            continue
        best = None
        for p, cid in claims:
            if match_claim(f["path"], p) and (best is None or len(p) > len(best[0])):
                best = (p, cid)
        if best is None:
            uncovered[f["path"].rsplit("/", 1)[0] if "/" in f["path"] else "."] += f["loc"]
        else:
            owner_of[f["path"]] = best[1]
    if uncovered:
        top = ", ".join(f"{d} ({kloc(n)})" for d, n in uncovered.most_common(40))
        problems.append(f"{sum(uncovered.values())} LoC belong to no context and are not in `unassigned`: {top}")

    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        for w in warnings:
            print(f"  ⚠ {w}")
        sys.exit(1)

    # Stats per context, from the inventory.
    stats = defaultdict(lambda: {"loc": 0, "files": 0, "commits": 0, "tables": [], "dirs": Counter()})
    for p, cid in owner_of.items():
        if cid is None:
            continue
        s = stats[cid]
        f = by_path[p]
        s["loc"] += f["loc"]
        s["files"] += 1
        s["dirs"][p.rsplit("/", 1)[0] if "/" in p else "."] += f["loc"]
    commits = {}
    for u in inv["units"]:
        for p in u["files"]:
            commits[p] = u["commits"] / max(1, len(u["files"]))
    for p, cid in owner_of.items():
        if cid:
            stats[cid]["commits"] += commits.get(p, 0)
    for t in inv["schema"]:
        path = t["ref"].rsplit(":", 1)[0]
        cid = owner_of.get(path) or next((cid for p, cid in sorted(claims, key=lambda x: -len(x[0])) if cid and match_claim(path, p)), None)
        if cid:
            stats[cid]["tables"].append(t)
    total = sum(f["loc"] for f in inv["files"] if f["lang"] and not f["tag"])
    assigned = sum(by_path[p]["loc"] for p, cid in owner_of.items() if cid)

    out_contexts = []
    for cid, c in contexts.items():
        s = stats.get(cid)
        entry = dict(c) | {"detail": details.get(cid, {})}
        if s:
            entry["stats"] = {"loc": s["loc"], "files": s["files"], "commits": round(s["commits"]),
                              "dirs": [[d, n] for d, n in s["dirs"].most_common(12)],
                              "tables": [{"name": t["name"], "ref": t["ref"]} for t in s["tables"][:60]]}
        out_contexts.append(entry)
    data = {
        "title": domain["title"], "domain": domain["domain"], "subdomains": domain["subdomains"],
        "contexts": out_contexts, "relationships": rels, "unassigned": domain.get("unassigned", []),
        "stats": {"loc": total, "assignedLoc": assigned, "files": sum(1 for f in inv["files"] if f["lang"] and not f["tag"]),
                  "date": date.today().isoformat(), "scope": inv["scope"], "slices": len(inv["slices"])},
        "link": inv["link"],
    }
    html = TEMPLATE.read_text()
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = html.replace("__MAP_TITLE__", escape(domain["title"])).replace("__MAP_DATA__", payload)
    out = Path(args.out) if args.out else ws / "map.html"
    out.write_text(html)
    for w in warnings:
        print(f"⚠ {w}")
    n = lambda key: sum(len(d.get(key, [])) for d in details.values())
    members = sum(len(a.get("members", [])) for d in details.values() for a in d.get("aggregates", []))
    print(f"Wrote {out}: {len(contexts)} contexts, {len(subdomains)} subdomains, {len(rels)} relationships, "
          f"{n('aggregates')} aggregates ({members} entities and value objects), {n('useCases')} use cases, "
          f"{n('events')} events; {kloc(assigned)} of {kloc(total)} LoC in contexts ({kb(len(html))})")


def check_context(d, cid, contexts, check_id, check_ref, need, problems):
    where = f"contexts/{cid}.json"
    if d.get("id") != cid:
        problems.append(f"{where}: `id` must be `{cid}`")
    ids = defaultdict(set)

    def register(kind, item, at):
        check_id(item.get("id"), at)
        if item.get("id") in ids[kind]:
            problems.append(f"{at}: id `{item.get('id')}` is used twice among {kind}")
        ids[kind].add(item.get("id"))
        need(item, "name", at)
        need(item, "description", at)
        if item.get("code"):
            check_ref(item["code"], at)

    for t in d.get("language", []):
        need(t, "term", f"{where} language")
        need(t, "meaning", f"{where} language {t.get('term')}")
        if t.get("code"):
            check_ref(t["code"], f"{where} term {t.get('term')}")
    for a in d.get("aggregates", []):
        at = f"{where} aggregate {a.get('id')}"
        register("aggregates", a, at)
        roots = [m for m in a.get("members", []) if m.get("root")]
        if len(roots) != 1:
            problems.append(f"{at}: needs exactly one member with \"root\": true (has {len(roots)})")
        mids = set()
        for m in a.get("members", []):
            mat = f"{at} member {m.get('id')}"
            check_id(m.get("id"), mat)
            if m.get("id") in mids:
                problems.append(f"{mat}: id used twice in this aggregate")
            mids.add(m.get("id"))
            need(m, "name", mat)
            need(m, "description", mat)
            if m.get("kind") not in ("entity", "value-object"):
                problems.append(f"{mat}: kind must be entity or value-object")
            if m.get("root") and m.get("kind") != "entity":
                problems.append(f"{mat}: the root must be an entity")
            if m.get("code"):
                check_ref(m["code"], mat)
        for ref in [a.get("repository")] if a.get("repository") else []:
            check_ref(ref, at)
    for v in d.get("valueObjects", []):
        register("valueObjects", v, f"{where} value object {v.get('id')}")
    for e in d.get("events", []):
        register("events", e, f"{where} event {e.get('id')}")
        for other in e.get("consumedBy", []):
            if other not in contexts:
                problems.append(f"{where} event {e.get('id')}: unknown consumer context `{other}`")
    for s in d.get("services", []):
        register("services", s, f"{where} service {s.get('id')}")
    for u in d.get("useCases", []):
        at = f"{where} use case {u.get('id')}"
        register("useCases", u, at)
        if u.get("kind", "command") not in ("command", "query"):
            problems.append(f"{at}: kind must be command or query")
    for a in d.get("aggregates", []):
        for e in a.get("events", []):
            if e not in ids["events"]:
                problems.append(f"{where} aggregate {a.get('id')}: unknown event `{e}`")
    for u in d.get("useCases", []):
        for a in u.get("aggregates", []):
            if a not in ids["aggregates"]:
                problems.append(f"{where} use case {u.get('id')}: unknown aggregate `{a}`")
        for e in u.get("emits", []):
            if e not in ids["events"]:
                problems.append(f"{where} use case {u.get('id')}: unknown event `{e}`")
    for f in d.get("findings", []):
        need(f, "title", f"{where} finding")
        if f.get("severity", "info") not in ("info", "warn", "risk"):
            problems.append(f"{where} finding {f.get('title')}: severity must be info, warn or risk")
        for ref in f.get("code", []):
            check_ref(ref, f"{where} finding {f.get('title')}")


def glob_like(p):
    return any(ch in p for ch in "*?[")


def match_claim(path, claim):
    if claim in ("", "."):
        return True
    if glob_like(claim):
        return fnmatch.fnmatch(path, claim) or fnmatch.fnmatch(path, claim.rstrip("/") + "/*")
    return path == claim or path.startswith(claim + "/")


def escape(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def kb(n):
    return f"{n / 1000:.0f} KB"


def cmd_remember(args):
    root = repo_root()
    ws = workspace(root, [s.strip("/") for s in args.scope])
    (ws / "url.txt").write_text(args.url.strip() + "\n")
    print(f"Remembered {args.url.strip()} in {ws / 'url.txt'}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def scoped(p):
        p.add_argument("--scope", action="append", default=[], help="limit to these paths (repeatable); same value for every command")
        return p

    p = scoped(sub.add_parser("scan"))
    p.add_argument("--unit-max", type=int, default=4000, help="LoC above which a directory is split into units")
    p.add_argument("--slice-max", type=int, default=15000, help="LoC per explorer slice")
    p.add_argument("--since", default="12.months", help="git churn window")
    p.set_defaults(fn=cmd_scan)
    p = scoped(sub.add_parser("status"))
    p.add_argument("--check", action="store_true", help="also validate each note")
    p.set_defaults(fn=cmd_status)
    p = scoped(sub.add_parser("outline"))
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--slice")
    g.add_argument("--path")
    p.set_defaults(fn=cmd_outline)
    p = scoped(sub.add_parser("check-notes"))
    p.set_defaults(fn=lambda a: cmd_status(argparse.Namespace(scope=a.scope, check=True)))
    p = scoped(sub.add_parser("digest"))
    p.add_argument("--slices", help="comma-separated slice ids, to read the digest in parts")
    p.add_argument("--context", help="only the slices whose files fall in this context's paths (needs model/domain.json)")
    p.add_argument("--brief", action="store_true", help="names only: no code references, meanings or finding texts")
    p.add_argument("--cross", action="store_true", help="only the cross-slice sections")
    p.set_defaults(fn=cmd_digest)
    p = scoped(sub.add_parser("check-context"))
    p.add_argument("context")
    p.set_defaults(fn=cmd_check_context)
    p = scoped(sub.add_parser("build"))
    p.add_argument("--model", help="model directory (default: <workspace>/model)")
    p.add_argument("--out", help="output HTML (default: <workspace>/map.html)")
    p.set_defaults(fn=cmd_build)
    p = scoped(sub.add_parser("remember"))
    p.add_argument("url")
    p.set_defaults(fn=cmd_remember)
    args = parser.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
