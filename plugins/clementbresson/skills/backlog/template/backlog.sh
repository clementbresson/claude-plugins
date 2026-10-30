#!/bin/sh
# Backlog helper. Needs sh, git and the usual grep, sed and awk.
# Usage: sh docs/todos/backlog.sh id|check|blocks
cd "$(dirname "$0")" || exit 2

new_id() {
  until
    id=$(LC_ALL=C tr -dc 2-9A-HJKMNP-TV-Z </dev/urandom | head -c4)
    case $id in
      *[A-Z]*) ! ls | grep -q "^T-$id-" && [ -z "$(git log --all --format=%h -1 -- "T-$id-*" 2>/dev/null)" ] ;;
      *) false ;;
    esac
  do :; done
  echo "T-$id"
}

# Everything TODO.md says about itself and about the files around it.
check_index() {
  awk '
    function problem(s) { print "TODO.md:" NR ": " s }
    BEGIN { split("CRITICAL HIGH MODERATE LOW Blocks", want, " ") }
    /^## / {
      h++; section = substr($0, 4)
      if (section != want[h]) problem("found ## " section ", want ## " want[h] ". The five headings stay, in this order.")
      next
    }
    section == "Blocks" {
      if (!/^- /) next
      if ($0 !~ /^- `[a-z0-9-]+` — ./) { problem("malformed block line, want - `name` — Goal."); next }
      name = $2; gsub(/`/, "", name)
      if (declared[name]++) problem(name ": block declared twice. Merge the two lines into one.")
      next
    }
    /^[ \t]*[-*+] |\]\(T-/ {
      if (!h) problem("ticket line above the first heading. Move it under its priority.")
      if ($0 !~ /^- \[T-[0-9A-Z]+\]\(T-[0-9A-Z]+-[^)]*\.md\)( `[a-z0-9-]+`)? — .*[^` ]$/) {
        problem("malformed line, want - [REF](FILE) `block` — Sentence.")
        next
      }
      ref = $0; sub(/^- \[/, "", ref); sub(/\].*/, "", ref)
      file = $0; sub(/^[^(]*\(/, "", file); sub(/\).*/, "", file)
      if (index(file, ref "-") != 1) problem("link text " ref " does not match its file " file)
      lines[file]++
      if ($3 ~ /^`/) { name = $3; gsub(/`/, "", name); used[name]++ }
    }
    END {
      if (h < 5) print "TODO.md: found " h " of the five headings: CRITICAL, HIGH, MODERATE, LOW, Blocks."
      for (b in used) if (!(b in declared)) print b ": block used but not declared. Add its line under ## Blocks."
      for (b in declared) if (!(b in used)) print b ": block has no open ticket. Check its goal: delete the line if it holds, cut a ticket if not."
      while (("ls" | getline f) > 0) {
        exists[f] = 1
        if (f !~ /^T-.*\.md$/) continue
        n = lines[f] + 0
        if (n != 1) print f ": " n " index lines. 0: add the line. 2 or more: merge them as in Merge conflicts."
        split(f, part, "-"); id = part[1] "-" part[2]
        if (seen[id]++) print id ": two files share this id. Give the one merged second a new id, as in Merge conflicts."
      }
      for (f in lines) if (!(f in exists)) print f ": linked from TODO.md but missing. Delete the line, or restore the file."
    }
  ' TODO.md
}

check_files() {
  ls | grep -vE '^(T-([0-9]+|[2-9A-HJKMNP-TV-Z]{4})-[a-z0-9-]+\.md|TODO\.md|TODO_RULES\.md|backlog\.sh)$' |
    sed 's/$/: unexpected file. A ticket is T-XXXX-short-slug.md, with XXXX from the alphabet in TODO_RULES.md./'
  ls | grep -E '^T-.*\.md$' | while read -r f; do
    id=$(echo "$f" | cut -d- -f1-2)
    head -1 "$f" | grep -q "^# $id " || echo "$f: first line must start with '# $id '"
    for s in Problem Fix 'Done when'; do
      grep -q "^## $s" "$f" || echo "$f: missing section ## $s"
    done
  done
  grep -lE '^(<{7} |={7}$|>{7} )' ./*.md 2>/dev/null | sed 's|^\./||; s/$/: conflict markers left. Resolve them as in Merge conflicts./'
  sed -n '/^## Blocks/,$p' TODO.md | grep -oE '\]\([^)]+\)' | sed 's/^](//; s/)$//; s/#.*//' | grep -v '://' | while read -r l; do
    [ -e "$l" ] || echo "$l: linked from ## Blocks but missing. Fix or delete the link."
  done
}

check() {
  [ -f TODO.md ] || { echo "TODO.md is missing"; return; }
  check_index
  check_files
}

# Each block with its goal, then its tickets in index order.
blocks() {
  awk '
    function after_dash(s) { return substr(s, index(s, " — ") + length(" — ")) }
    /^## / { section = substr($0, 4); next }
    section == "Blocks" {
      if (/^- `/) { name = $2; gsub(/`/, "", name); order[++n] = name; goal[name] = after_dash($0) }
      next
    }
    /^- \[T-/ && $3 ~ /^`/ {
      name = $3; gsub(/`/, "", name)
      ref = $2; sub(/^\[/, "", ref); sub(/\].*/, "", ref)
      members[name] = members[name] "  " section " " ref " " after_dash($0) "\n"
    }
    END { for (i = 1; i <= n; i++) printf "%s: %s\n%s\n", order[i], goal[order[i]], members[order[i]] }
  ' TODO.md
}

case "$1" in
  id) new_id ;;
  check) ! check | grep . ;;
  blocks) blocks ;;
  *) echo "usage: sh docs/todos/backlog.sh id|check|blocks" >&2; exit 2 ;;
esac
