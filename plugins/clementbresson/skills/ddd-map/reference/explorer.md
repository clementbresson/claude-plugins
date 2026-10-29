# Explorer brief: one slice of the codebase

You explore one **slice** of a large codebase (up to about 15k lines of code)
and write down the domain you find in it, as notes another agent will merge
with the notes of every other slice. You see only your slice; the merge sees
only your notes. Anything you leave out is lost, and anything vague is
useless to it.

Your prompt gives you: the slice id, the workspace folder `WS`, the script
`ddd.py` path, and the repository root (run every command from there).

## Steps

1. **Read `WS/brief.md`.** It says what the business does and lists the
   vocabulary found so far. Use its words for subdomains and contexts when
   they fit what you see, so the notes of all slices line up.

2. **Outline the slice.**
   `python3 DDD --scope … outline --slice SID` (repeat the `--scope` flags
   given in your prompt, if any) lists every file with its line count, its
   signals (`orm`, `aggregate`, `value-object`, `event`, `command`,
   `repository`, `route`, `http-client`, `queue`, `ui`) and its declarations
   with line numbers. This is your map of the slice.

3. **Read in order of domain density.** Read in full every file that
   declares domain types or rules: files with `orm`, `aggregate`,
   `value-object`, `event`, `command` or `repository` signals, folders named
   `domain`, `model`, `entities`, `core`, `application`, `use-cases`,
   `services`, and schema files. Then read the entry points (`route`,
   `queue`, handlers, jobs) far enough to know which use case each one runs.
   UI components, generated clients, config and plumbing are known from the
   outline alone; list them under `skimmed`. Open a test when it is the
   clearest statement of a rule.

4. **Write the note** to the path `status` prints for your slice
   (`WS/notes/<hash>.json`), in the format below.

5. **Validate.** Run `python3 DDD --scope … status --check` and fix every
   problem listed under your slice id. Done when your slice shows `done`.

6. **Reply** with one line only: `SID done: N concepts, M integrations,
   context hints: A, B`. The notes file is the result; the reply only signals
   that it exists.

## What to capture

Write down the domain as the code implements it, even when the code is not
written in a DDD style. Most codebases are not: a Sequelize model with three
service functions around it is still an entity with behaviour, and a set of
tables always written together is still an aggregate. Describe what is there;
the merge decides what to call it.

- **Concepts.** Every business noun with state (entities, value objects,
  aggregates), every business verb (commands, use cases, queries), every fact
  the system records or broadcasts (domain events), and the rules that guard
  them. For each, give the file and line where it is defined, its key
  attributes with types, its behaviour (methods that change or decide
  something), and its invariants: the checks that throw, refuse or clamp.
  A rule enforced in a controller or a SQL constraint is still a rule; say
  where it lives.
- **Terms.** Words of the business as this slice uses them, with their
  meaning here. A word whose meaning differs from `brief.md` or from what its
  name suggests is the most valuable thing you can note.
- **Integrations.** Everything that crosses the slice boundary: imports of
  code outside the slice (name the folder), HTTP calls, published and
  consumed events or queue messages, webhooks, shared tables, third-party
  SDKs. Say what crosses: which data, which call, in which direction.
- **Tables.** The tables or collections this slice owns (declares, migrates,
  writes) or only reads.
- **Findings.** What a domain modeler would flag: business rules in the UI or
  in SQL, a model reused across two meanings, an entity with no behaviour
  while services mutate it, a cross-module import that bypasses a public
  interface, duplicated logic.

## Note format

```json
{
  "slice": "s07",
  "summary": "What this code does for the business, in 2 to 4 sentences, with its main nouns.",
  "role": "domain",
  "subdomainHints": ["Invoicing", "Dunning"],
  "contextHints": [
    { "name": "Billing", "paths": ["src/billing"], "why": "Own models, own tables, talks to the rest through BillingApi only." }
  ],
  "terms": [
    { "term": "Invoice", "meaning": "A bill sent to a customer; immutable once sent.", "code": "src/billing/invoice.ts:12" }
  ],
  "concepts": [
    {
      "kind": "entity",
      "name": "Invoice",
      "description": "A bill for one customer and period; can be sent once, then only paid or voided.",
      "code": "src/billing/invoice.ts:12",
      "partOf": "Invoice",
      "attributes": ["number: InvoiceNumber", "lines: InvoiceLine[]", "status: draft | sent | paid | void"],
      "behaviours": ["send()", "markPaid(payment)"],
      "invariants": ["A sent invoice cannot change its lines (throws InvoiceLocked)."],
      "emits": ["InvoiceSent"],
      "touches": [],
      "why": "Has an id and a lifecycle; its repository saves it with its lines in one transaction."
    }
  ],
  "integrations": [
    { "direction": "out", "kind": "http", "target": "Stripe", "what": "Creates a payment intent per invoice.", "code": "src/billing/stripe.ts:40" }
  ],
  "tables": [{ "name": "invoices", "access": "owns", "code": "prisma/schema.prisma:88" }],
  "findings": [
    { "title": "Discount rule in the UI", "text": "The 10% loyalty discount is computed in the checkout component only.", "code": "web/checkout.tsx:120" }
  ],
  "skimmed": ["web/components/InvoiceTable.tsx — UI table"]
}
```

- `role`: `domain`, `application`, `infrastructure`, `ui`, `mixed` or
  `tooling`, whichever describes most of the slice.
- `kind` is one of `aggregate`, `entity`, `value-object`, `domain-event`,
  `command`, `query`, `use-case`, `domain-service`, `policy`, `repository`,
  `factory`, `read-model`, `saga`, `external-system`, `enum`.
- `partOf` names the aggregate a concept belongs to, when you can tell.
- `code` is `path`, `path:line` or `path:start-end`, relative to the
  repository root, pointing where the thing is defined. Every reference is
  checked against the files.
- `why` says what in the code made you classify it that way. Keep it to a
  sentence.
- Concepts of the same name in two places get two entries, each with its own
  description: they may be two meanings of one word.
