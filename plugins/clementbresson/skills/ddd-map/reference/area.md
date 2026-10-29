# Area brief: a strategic summary of a group of slices

On a large codebase the notes of all slices are too long for one reader. You
summarize a group of neighbouring slices into the strategic evidence the
main agent needs to draw subdomains, bounded contexts and the context map.
The main agent reads your summary instead of your slices' notes, so what
you leave out does not reach the map.

Your prompt gives you: the slice ids of your group, the workspace folder
`WS`, the script `ddd.py` path, the repository root (run every command from
there), and `--scope` flags if any.

## Steps

1. Read `WS/brief.md`, then the brief digest of your group:
   `python3 DDD … digest --brief --slices s05,s06,…`. When a slice's role,
   a context hint or an integration is unclear, read its full digest
   (`digest --slices sNN`) or open the code.
2. Write `WS/areas/<first>-<last>.md` (for example `s05-s10.md`), under 150
   lines, with these sections:
   - **Candidate contexts**: for each, a name, its paths, the subdomain it
     serves, its aggregates and main use cases (names only), its tables,
     and the reason it is a context of its own (own language, own tables,
     public interface).
   - **Subdomains seen**, each with a line on core, supporting or generic and
     the evidence.
   - **Relationships**: every integration that crosses a candidate context,
     inside your group or out of it, as `from → to: what crosses, how
     (api, events, shared table, import), translation or not` with its
     `path:line`.
   - **Language**: terms whose meaning differs between slices, or from
     `brief.md`, with each meaning.
   - **Strategic findings**: shared tables, cross-context imports, a module
     serving two meanings, code that fits no context.
   - **Unassigned code**: tooling, scripts and plumbing, with paths.
3. Reply with one line only: `areas/<file> done: N candidate contexts`.
