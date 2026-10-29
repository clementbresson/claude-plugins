# Modeler brief: one bounded context

You write the tactical model of one bounded context: its language,
aggregates, entities, value objects, use cases, events, services and
findings. The strategic design is already decided in `WS/model/domain.json`;
your file is `WS/model/contexts/<id>.json`, and the page shows it as the
context's own pages.

Your prompt gives you: the context id, the workspace folder `WS`, the script
`ddd.py` path, the repository root (run every command from there), and
`--scope` flags if any.

## Steps

1. **Read** `WS/brief.md`, then `WS/model/domain.json`: your context's
   description, subdomains, paths and relationships, and the other contexts'
   ids (for `consumedBy`). Then read the modeling reference this brief sits
   next to (`modeling.md`), sections *Tactical design* and
   `contexts/<id>.json`.

2. **Gather the explorers' notes** for your context:
   `python3 DDD … digest --context ID`. It prints the notes of every slice
   whose files fall in your paths. Notes from a slice shared with other
   contexts also describe code that is not yours: keep only concepts whose
   `code` is inside your paths.

3. **Check the model against the code.** Notes come from explorers who saw
   one slice each. Open the definition of every aggregate root you plan to
   write, its repository and its main commands, and confirm the members,
   attributes, behaviours and invariants. Resolve concepts that several
   slices named differently into one name, using the context's vocabulary.

4. **Write `WS/model/contexts/ID.json`** in the format of the reference.
   Every concept of your context that the notes list appears in it, as a
   member, value object, use case, event or service, or is merged into one
   that does (a duplicate under another name). Each aggregate has one root.
   Use cases cover every entry point the notes list: routes, handlers, jobs.

5. **Validate**: `python3 DDD … check-context ID`. Fix every problem it
   lists. Done when it prints `ok`.

6. **Reply** with one line only: `ID done: N aggregates, M use cases, K
   events, F findings`.
