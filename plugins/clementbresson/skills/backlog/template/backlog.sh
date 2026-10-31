#!/bin/sh
# Backlog helper. Needs sh, git and the usual grep, sed and awk.
# Usage: sh docs/todos/backlog.sh id|new SLUG|check|list [TERM...]|blocks [NAME]|human|tags
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

new_ticket() {
  echo "$1" | grep -qE '^[a-z0-9-]+$' || { echo "usage: sh docs/todos/backlog.sh new short-lowercase-slug" >&2; exit 2; }
  id=$(new_id)
  sed "s/T-XXXX/$id/; s/^found: .*/found: $(date +%F)/" TEMPLATE.md > "$id-$1.md" || exit 2
  echo "docs/todos/$id-$1.md"
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
        problem("malformed line, want - [REF](FILE) `block` — Sentence. The block is optional.")
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
  ls | grep -vE '^(T-([0-9]+|[2-9A-HJKMNP-TV-Z]{4})-[a-z0-9-]+\.md|TODO\.md|TODO_RULES\.md|TEMPLATE\.md|backlog\.sh)$' |
    sed 's/$/: unexpected file. A ticket is T-XXXX-short-slug.md, with XXXX from the alphabet in TODO_RULES.md./'
  ls | grep -E '^T-.*\.md$' | while read -r f; do
    id=$(echo "$f" | cut -d- -f1-2)
    sed -n 1p "$f" | grep -qx -- '---' && sed -n 6p "$f" | grep -qx -- '---' || echo "$f: frontmatter must be the first 6 lines, as in TEMPLATE.md."
    sed -n 2p "$f" | grep -qE '^type: (bug|security|data|debt|improvement|ops|decision)$' || echo "$f: line 2 must be type: bug, security, data, debt, improvement, ops or decision."
    sed -n 3p "$f" | grep -qE '^found: [0-9]{4}-[0-9]{2}-[0-9]{2}$' || echo "$f: line 3 must be found: YYYY-MM-DD."
    sed -n 4p "$f" | grep -qE '^when: (now|(from|by) [0-9]{4}-[0-9]{2}-[0-9]{2}|(after|before) .+)$' || echo "$f: line 4 must be when: now, from YYYY-MM-DD, by YYYY-MM-DD, after a condition or before a condition."
    sed -n 5p "$f" | grep -qE '^tags: \[([a-z0-9][a-z0-9-]*(, [a-z0-9][a-z0-9-]*)*)?\]$' || echo "$f: line 5 must be tags: [] or tags: [human, other-tag], in lowercase kebab-case."
    sed -n 8p "$f" | grep -q "^# $id " || echo "$f: line 8 must start with '# $id '"
    for p in 'The problem, stated as a sentence' 'What is wrong, where' 'The one change that closes it' 'A condition anyone can check'; do
      grep -qF "$p" "$f" && echo "$f: template text left: $p"
    done
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

# Reads one index line and its ticket file. The awk programs below share this.
ticket_awk='
  function load_open_ids(    f, part) {
    while (("ls" | getline f) > 0) if (f ~ /^T-.*\.md$/) { split(f, part, "-"); open_ids[part[1] "-" part[2]] = 1 }
  }
  function has_tag(t) { return index(" " tags " ", " " t " ") > 0 }
  function read_ticket(    line, rest, id, in_fix, n) {
    ref = $2; sub(/^\[/, "", ref); sub(/\].*/, "", ref)
    file = $0; sub(/^[^(]*\(/, "", file); sub(/\).*/, "", file)
    block = $3 ~ /^`/ ? $3 : ""; gsub(/`/, "", block)
    sentence = substr($0, index($0, " — ") + length(" — "))
    type = ""; when = ""; tags = ""; waits_on = ""; in_fix = 0; n = 0
    while ((getline line < file) > 0) {
      n++
      if (n == 2) type = substr(line, 7)
      if (n == 4) when = substr(line, 7)
      if (n == 5) { tags = substr(line, 7); gsub(/[][,]/, "", tags) }
      if (line ~ /^## /) in_fix = line ~ /^## Fix/
      rest = line
      while (in_fix && match(rest, /Land after T-[0-9A-Z]+/)) {
        id = substr(rest, RSTART + length("Land after "), RLENGTH - length("Land after "))
        if (id in open_ids) waits_on = waits_on (waits_on == "" ? "" : ", ") id
        rest = substr(rest, RSTART + RLENGTH)
      }
    }
    close(file)
  }
  function describe() {
    return section " " ref (block == "" ? "" : " `" block "`") (tags == "" ? "" : " [" tags "]") " — " sentence
  }
'

# Tickets in index order that match every term: a priority, a type, a block, a tag, or none for no block.
# Several priorities or several types match any of them.
list() {
  awk -v terms="$*" "$ticket_awk"'
    BEGIN {
      n = split(terms, term, " ")
      split("critical high moderate low", known, " "); for (i in known) is_priority[known[i]] = 1
      split("bug security data debt improvement ops decision", known, " "); for (i in known) is_type[known[i]] = 1
      for (i = 1; i <= n; i++) {
        if (term[i] in is_priority) want_priority[term[i]] = 1
        else if (term[i] in is_type) want_type[term[i]] = 1
        else other[term[i]] = 1
      }
    }
    /^## / { section = substr($0, 4); next }
    /^- \[T-/ && section != "Blocks" {
      read_ticket()
      ok = 1
      for (t in other) {
        hit = (t == "none" ? block == "" : t == block || has_tag(t))
        if (hit) found[t] = 1; else ok = 0
      }
      for (t in want_priority) { any_priority = 1; break }
      for (t in want_type) { any_type = 1; break }
      if (any_priority && !(tolower(section) in want_priority)) ok = 0
      if (any_type && !(type in want_type)) ok = 0
      if (ok) { print describe() " [" when "]"; shown++ }
    }
    END {
      for (t in other) if (!(t in found)) print "no ticket has the block or tag " t > "/dev/stderr"
    }
  ' TODO.md
}

# Each block with its goal, then its tickets in index order. A name shows one block.
blocks() {
  awk -v only="$1" "$ticket_awk"'
    /^## / { section = substr($0, 4); next }
    section == "Blocks" {
      if (/^- `/) { name = $2; gsub(/`/, "", name); order[++n] = name; goal[name] = substr($0, index($0, " — ") + length(" — ")) }
      next
    }
    /^- \[T-/ {
      read_ticket()
      if (block == "") { unblocked++; next }
      members[block] = members[block] "  " section " " ref (tags == "" ? "" : " [" tags "]") " " sentence "\n"
    }
    END {
      for (i = 1; i <= n; i++)
        if (only == "" || only == order[i]) printf "%s: %s\n%s\n", order[i], goal[order[i]], members[order[i]]
      if (only == "") printf "no block: %d tickets. List them with: sh docs/todos/backlog.sh list none\n", unblocked
    }
  ' TODO.md
}

# Human tickets in index order, split by whether a person can act on them today.
human() {
  awk -v today="$(date +%F)" "$ticket_awk"'
    BEGIN { load_open_ids() }
    /^## / { section = substr($0, 4); next }
    /^- \[T-/ && section != "Blocks" {
      read_ticket()
      if (!has_tag("human")) next
      date = substr(when, length(when) - 9)
      if (waits_on != "") { group = 3; note = "land after " waits_on }
      else if (when ~ /^from / && date > today) { group = 3; note = when }
      else if (when ~ /^after /) { group = 2; note = when }
      else if (when ~ /^by / && date < today) { group = 1; note = "OVERDUE, " when }
      else { group = 1; note = when }
      out[group] = out[group] "  " describe() " [" note "]\n"
    }
    END {
      printf "Do now:\n%s", out[1]
      printf "Do once its condition holds:\n%s", out[2]
      printf "Waiting:\n%s", out[3]
    }
  ' TODO.md
}

# Every tag in use, most used first, so a new ticket reuses a word instead of inventing one.
tags() {
  ls | grep -E '^T-.*\.md$' | while read -r f; do sed -n 5p "$f"; done |
    sed 's/^tags: //' | tr -d '[],' | tr ' ' '\n' | grep . | sort | uniq -c | sort -rn
}

case "$1" in
  id) new_id ;;
  check) ! check | grep . ;;
  new) new_ticket "$2" ;;
  list) shift; list "$@" ;;
  blocks) blocks "$2" ;;
  human) human ;;
  tags) tags ;;
  *) echo "usage: sh docs/todos/backlog.sh id|new SLUG|check|list [TERM...]|blocks [NAME]|human|tags" >&2; exit 2 ;;
esac
