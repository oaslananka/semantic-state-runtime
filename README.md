# Semantic State Runtime Lab

Open engineering lab for a user-owned, protocol-neutral Personal AI Runtime.

The repository is testing the hard infrastructure needed for one person's durable context to remain usable across AI models and agent transports without making any model vendor or source application the canonical owner of that context.

## Try it from a fresh clone

With Node.js 24.12+ and pnpm 12.x, run this no-credential, no-network
deterministic demo:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:handoff
```

For a real chat model without manually writing MCP configuration, run
`pnpm demo:chat-setup` from the repo root. It prepares a
disposable synthetic workspace and prints the tested OpenCode v2.3.0
command (one free NVIDIA Build API key needed for the subsequent model
request). The generated runtime is read-only. See
[first-use instructions](examples/README.md#opencode-v2-first-use-local-mcp).

The same synthetic, read-only MCP context was also verified in **Goose CLI v1.59.0**; see [the second-client acceptance](examples/README.md#second-chat-client-goose-cli-verified).
## Runnable two-agent MCP demo

A deterministic local demo shows one MCP agent client reconciling a project decision and a second client retrieving current semantic state after a runtime restart:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:handoff
```

For an optional real two-model MCP handoff using free NVIDIA Build endpoints, see [examples/README.md](examples/README.md) (`pnpm demo:llm-handoff`).

The deterministic command uses synthetic files and SQLite without an LLM. The optional live command adds two real model APIs to that same synthetic, policy-scoped MCP scenario; neither demonstrates cross-device sync. See [the demo walkthrough](examples/README.md) for evidence boundaries.

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
