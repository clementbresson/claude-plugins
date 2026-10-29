# Modeling reference

How to read a domain out of code, and the two files the page is built from:
`WS/model/domain.json` (strategic design) and `WS/model/contexts/<id>.json`
(tactical design, one per internal context).

## Strategic design

**Business domain.** What the company sells, to whom, and how it earns
money, in the words of its customers. Sources, in order of trust: the
product's public website and docs, the README and docs folders, the names of
the use cases and screens, the database schema. Cite them in
`domain.sources`.

**Subdomains** split the problem, independent of how the code is cut. Find
them in the business capabilities the use cases serve (sell passes, onboard
partners, notify users), then classify each one:

- **core**: what makes this product worth choosing. Signs: the richest rules,
  custom algorithms, the vocabulary of the pitch, the highest churn in the
  inventory, the most senior authors. Usually 1 to 3 per company.
- **supporting**: specific to this business, needed, but not a reason to buy:
  back-office flows, partner management, reporting. Often CRUD with a few
  rules.
- **generic**: solved problems every company has: identity and login,
  payments, email and push delivery, file storage, feature flags, analytics
  plumbing. Often a third-party service behind an adapter.

Write `why` for each classification, naming the evidence.

**Bounded contexts** split the solution: each is the boundary inside which
one model and one vocabulary hold. Draw them from evidence, strongest first:

1. A word that means two things (the `homonyms` of the scan, the terms
   defined in several slices of the digest): the boundary runs between the
   two meanings.
2. Separate deployables, schemas or databases (`manifests`, `schema`).
3. Modules that talk to the rest only through a public interface (an API
   client, events, a facade), and import clusters from the scan.
4. Ownership: CODEOWNERS teams, author groups.
5. The folder structure, last: folders follow layers (controllers, services,
   models) as often as domains. A context cut by layer is the classic
   mistake; a context owns its whole vertical slice.

A context usually implements one subdomain; one that implements several, or
a subdomain spread over several contexts, is worth a sentence in its
description. Frontends and apps are rarely contexts of their own: their code
goes to the context whose model they display, or to `unassigned` when they
are a shell over several contexts (say so in the reason). Third-party systems
the code integrates with (Stripe, Postmark, an ERP) appear as contexts with
`"kind": "external"` and no paths, so the map shows the integration.
When the analysis is limited to part of the codebase, the contexts it talks
to outside that part appear with `"kind": "outside"`, no paths and no
subdomains required, so their relationships stay on the map.

**Relationships** come from integration evidence; cite file and line in
`evidence`. Draw an edge between two contexts only when one depends on
the other, with the upstream being the one whose model the other has to
follow.

| Evidence in the code | Pattern |
|---|---|
| Downstream translates the upstream's model into its own (mapper, adapter, translator class) | `ACL` on the downstream end |
| Downstream uses the upstream's types as-is | `CF` (conformist) |
| Upstream exposes an API or client meant for several consumers | `OHS` on the upstream end |
| A documented schema between them: OpenAPI, protobuf, versioned event payloads | `PL` |
| Upstream's roadmap serves this downstream (one team asks, the other delivers) | `CS` |
| Both import one shared module of domain code | `SK`, `via: shared-code` |
| Both read or write the same tables | `via: shared-db`; a shared kernel at best, say so in a finding |
| Two teams that change in lockstep | `P` |
| Duplicate implementations on purpose, no integration | `SW` |

`via` is `api`, `events`, `shared-db`, `shared-code`, `library`, `file` or
`ui`.

## Tactical design

Read the domain as the code implements it. Explicit DDD code is rare; most
code expresses the same ideas through ORM models, services and handlers.
Model those ideas, and mark what you inferred with `"inferred": true`.

- **Entity**: has an identity that outlives its attribute changes (an id
  column, a lifecycle, a status). An ORM model with an id is an entity.
- **Value object**: defined by its values, no identity, replaced not edited:
  money, email, date range, address, a validated id type, an enum with
  behaviour. Columns that always travel together (amount + currency) are a
  value object even when the code keeps them as primitives; note that as a
  finding.
- **Aggregate**: the cluster of entities and value objects saved together in
  one transaction, with one **root** that every change goes through and that
  keeps the rules (**invariants**) true. Find it from the repository (one per
  root), from cascades and owned child tables, from the transaction boundary
  of each command. One aggregate per table group, not per table: an order
  and its lines are one aggregate.
- **Invariants**: the rules that must hold after every change. Phrase each as
  a business rule ("A sent invoice cannot change its lines"), and say where
  it is enforced when it is not in the aggregate.
- **Domain event**: a fact in the past tense that something else reacts to.
  Queue messages, webhooks emitted, `emit`/`publish` calls and audit rows all
  qualify.
- **Use case**: one user or system intent, as a **command** (changes state)
  or a **query** (reads). Find them in controllers, route handlers, resolvers,
  jobs and message handlers; name each by its intent ("Send an invoice"),
  with its `trigger` (`POST /invoices/:id/send`, `cron daily`, `on
  PaymentSucceeded`) and `actor`.
- **Services**: domain services (rules that span aggregates), policies
  (when X happens, do Y), factories, sagas and read models, with `kind`
  saying which.

**Findings** carry the analysis: leaking boundaries, anaemic models (entities
without behaviour, rules in services or controllers), a giant aggregate,
primitive obsession, shared tables, a term with two meanings inside one
context. Severity: `risk` for what can corrupt data or block change, `warn`
for design debt, `info` for observations.

## `domain.json`

```json
{
  "version": 1,
  "title": "Acme Billing",
  "domain": {
    "name": "Accounts receivable for small businesses",
    "description": "Who the customers are, what they buy, how the company earns money. A blank line separates paragraphs; `code` and **bold** are the only markup.",
    "sources": [{ "label": "acme.com", "url": "https://acme.com" }, { "label": "README", "code": "README.md" }]
  },
  "subdomains": [
    { "id": "invoicing", "name": "Invoicing", "type": "core", "description": "…", "why": "Richest rules and highest churn: src/billing changed 140 times this year." }
  ],
  "contexts": [
    {
      "id": "billing", "name": "Billing", "kind": "internal",
      "description": "What this context is responsible for, and the model it holds.",
      "subdomains": ["invoicing"],
      "paths": ["src/billing", "web/src/app/invoices"],
      "team": "@acme/billing"
    },
    { "id": "stripe", "name": "Stripe", "kind": "external", "description": "Card payments.", "subdomains": ["payments"] }
  ],
  "relationships": [
    {
      "upstream": "identity", "downstream": "billing", "patterns": ["OHS", "ACL"], "via": "api",
      "description": "Billing reads users through the identity client and maps them to its own Customer.",
      "evidence": ["src/billing/acl/customer-translator.ts:8"]
    }
  ],
  "unassigned": [{ "path": "scripts", "reason": "Build and deploy tooling." }]
}
```

- Ids are lowercase words joined by single hyphens (`local-pass`), unique per
  kind. They become the page's links.
- `paths` are repository paths (folders or files, or globs). A file belongs to
  the context with the longest matching path, so `src` in one context and
  `src/billing` in another is fine.
- Every source file must fall in a context's `paths` or in `unassigned`
  (with a reason); `build` lists the directories left over.

## `contexts/<id>.json`

```json
{
  "id": "billing",
  "language": [{ "term": "Invoice", "meaning": "A bill sent to one customer for one period.", "code": "src/billing/invoice.ts:12" }],
  "aggregates": [
    {
      "id": "invoice", "name": "Invoice",
      "description": "An invoice with its lines; drafted, sent once, then paid or voided.",
      "code": "src/billing/invoice.ts:12",
      "repository": "src/billing/invoice-repository.ts:5",
      "invariants": ["A sent invoice cannot change its lines.", "Total equals the sum of the lines, in one currency."],
      "members": [
        {
          "id": "invoice", "kind": "entity", "root": true, "name": "Invoice",
          "description": "…", "code": "src/billing/invoice.ts:12",
          "attributes": ["number: InvoiceNumber", "status: draft | sent | paid | void"],
          "behaviours": ["send()", "markPaid(payment)"],
          "invariants": []
        },
        { "id": "invoice-line", "kind": "entity", "name": "InvoiceLine", "description": "…", "code": "…", "attributes": ["…"] },
        { "id": "money", "kind": "value-object", "name": "Money", "description": "…", "code": "…", "attributes": ["amount: int (cents)", "currency: ISO 4217"] }
      ],
      "events": ["invoice-sent"],
      "inferred": false
    }
  ],
  "valueObjects": [{ "id": "customer-id", "name": "CustomerId", "description": "Shared by several aggregates.", "code": "…", "attributes": ["value: uuid"] }],
  "useCases": [
    {
      "id": "send-invoice", "name": "Send an invoice", "kind": "command",
      "description": "…", "actor": "Accountant", "trigger": "POST /invoices/:id/send",
      "code": "src/billing/send-invoice.ts:20", "aggregates": ["invoice"], "emits": ["invoice-sent"],
      "steps": ["Load the invoice", "Lock its lines", "Email the PDF"]
    }
  ],
  "events": [
    { "id": "invoice-sent", "name": "InvoiceSent", "description": "…", "code": "…", "attributes": ["invoiceId: uuid"], "consumedBy": ["notifications"] }
  ],
  "services": [{ "id": "dunning-policy", "name": "Dunning policy", "kind": "policy", "description": "…", "code": "…" }],
  "findings": [
    { "severity": "warn", "title": "Invoice has no behaviour", "text": "Status changes happen in three services.", "code": ["src/billing/a.ts:10", "src/billing/b.ts:44"] }
  ]
}
```

- Each aggregate has exactly one member with `"root": true`, an entity.
- `aggregates`, `emits`, `events` and `consumedBy` refer to ids in this file
  (`consumedBy` to context ids in `domain.json`).
- Every `code` reference is checked against the files.
