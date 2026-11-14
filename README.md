# Semantic State Runtime Lab

**One authoritative fact. Two MCP clients. The right answer after a restart.**

Semantic State Runtime Lab is a public engineering project for durable,
source-aware and policy-scoped AI context. It is **not yet a consumer product**.

Start with Project Atlas: a local copy says a deadline is November 15, but
the trusted source says November 20. One MCP client reconciles the difference;
another client opens a fresh runtime and retrieves the authorized value.
Restricted evidence stays out of the returned context.

## Try the handoff

With Node.js 24.12+ and pnpm 12.x, install dependencies and run the **local, no-key** demo:

~~~bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:handoff
~~~

Package installation may fetch dependencies; the demo itself makes **no external requests**.
The output reports the observed **before / authoritative source / after /
fresh-client answer** values, not an invented chat transcript. It uses
synthetic Markdown and SQLite files, two real MCP SDK clients, and deletes
the temporary data when finished. No hosted model is called.

**[See the 90-second walkthrough and expected output](examples/SHOWCASE.md).**

## Real AI chat clients

The same local, read-only SSRL context was separately tested with **OpenCode
v2.3.0** and **Goose CLI v1.59.0**. In each application a model generated a
real MCP `context.compile` call and answered `2026-11-20` using the returned
authorized record. These are two independent chat applications, **not** two
independent model providers: both used one NVIDIA developer gateway on one
Windows host and synthetic project data.

To prepare an isolated OpenCode workspace without authoring MCP JSON by
hand, run `pnpm demo:chat-setup` after building. It prints an optional
command requiring an existing NVIDIA developer API key. The preparation
itself is offline and the generated SSRL principal is **read-only**.
For the optional live two-model handoff, use `pnpm demo:llm-handoff`.

Full instructions and honest limits:
[OpenCode and Goose walkthroughs](examples/README.md). No cross-device
synchronization, real-user-data readiness or production hosting is claimed.

## Current architecture

```text
source systems / local files
        ↓
connectors + restart-safe ingestion
        ↓
immutable Artifact Plane + Semantic State Store
        ↓
bitemporal state / retractions / typed identity / relations
        ↓
incremental Context Capsules
        ↓
Context Access Gateway
        ↓
retrieval / future agent adapters

AI side effects:
agent -> RuntimeHost plan/apply -> provider preconditions -> journal
```

Implemented checkpoints include:

- canonical entity identity and typed alias resolution;
- bitemporal semantic observations and immutable retractions;
- explicit field authority and conflict detection;
- deterministic reconciliation planning and proposal digests;
- durable SQLite semantic state + ordered change feed;
- incremental, time-aware context capsules;
- Markdown filesystem and Google Calendar ingestion adapters;
- immutable content-addressed Artifact Plane;
- policy-enforced artifact access;
- local stdio MCP composition;
- authenticated stateless MCP 2026-07-28 HTTP composition;
- principal-aware, capsule-backed derived context access;
- MCP `context.compile` projection with authenticated `context:read` preflight;
- policy-scoped prefix-Merkle replication with bounded resumable sessions;
- principal-scoped immutable record + artifact blob transfer;
- authenticated bounded replication HTTP with real two-node semantic/artifact convergence;
- optional Ed25519 device-bound HTTP Message Signature authentication with replay defense;
- epoch-scoped opaque encrypted replication object identities that hide plaintext record/blob identifiers and digests from an untrusted relay;
- descriptor-generic prefix-Merkle + bounded reconciliation with epoch-scoped opaque views and no plaintext reconciliation metadata.

## Design posture

Core constraints are intentionally stricter than a conventional "RAG over personal files" system:

- source evidence remains auditable;
- derived caches/indexes are rebuildable and never define truth;
- authorization happens before identity resolution/ranking when disclosure could leak hidden state;
- agents receive bounded semantic context rather than unrestricted source-system search;
- transport authentication and domain authorization are separate layers;
- protocol adapters such as MCP do not define canonical semantics.

See `docs/invariants.md` and the versioned design documents under `docs/`.

## Near-term gaps

The lab is not yet a consumer product. Important remaining work includes:

- more source connectors and semantic mappings;
- historical context-access semantics;
- opaque provenance/evidence expansion handles;
- device enrollment, sender-constrained authentication and key rotation;
- ciphertext object storage and opaque-only HTTP relay integration for untrusted relay/cloud deployments;
- active-active source receipt/witness semantics;
- deployment composition, real IdP verifier integration and observability;
- product UX, onboarding, sync operations and commercial packaging.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm benchmark:context:v2
pnpm benchmark:google-calendar:v1
pnpm benchmark:markdown:v1
pnpm test:stdio
```
