<h1 align="center">Semantic State Runtime</h1>

<p align="center">
  <a href="https://github.com/oaslananka/semantic-state-runtime/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/oaslananka/semantic-state-runtime/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/semantic-state-runtime"><img alt="npm preview" src="https://img.shields.io/npm/v/semantic-state-runtime/next.svg?label=npm%20next"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://gitgem.org/github/oaslananka/semantic-state-runtime"><img alt="GitGem" src="https://gitgem.org/api/badge/github/oaslananka/semantic-state-runtime.svg"></a>
</p>

**Durable, authoritative context for AI agents — accessible through MCP.**

> **Status: Developer Preview.** This is a working engineering runtime and MCP
> server with a public [npm Developer Preview](https://www.npmjs.com/package/semantic-state-runtime) (`next` dist-tag), **not** a supported consumer app, stable release, or hosted service.

Semantic State Runtime (SSRL) helps AI agents use the **right information**
when several sources disagree. It reconciles writable state against explicit
source authority, persists the result across sessions and exposes only
policy-authorized context through the Model Context Protocol (MCP).

## Why it matters

Imagine a project deadline is **November 15** in a stale local copy,
but the trusted source says **November 20**. Rather than letting an AI
assistant guess, SSRL can:

1. Identify which source is authoritative for the field.
2. Produce and apply a precondition-checked correction to the writable copy.
3. Give a new MCP client the authorized, current deadline after restart.
4. Exclude fields and evidence the client is not permitted to see.

This is **state reconciliation and access-controlled context**, not simply
chat-history memory, an unrestricted file search, or an LLM provider.

## Try the npm Developer Preview

Requirements: **Node.js 24.12+** and npm. No Git clone, workspace build,
API key, or model account is needed to try the **synthetic read-only** MCP server.

~~~bash
npm install -g semantic-state-runtime@next
ssrl-demo-init ./ssrl-example
ssrl-node --version
~~~

The initializer creates a **new** folder and refuses to overwrite one.
It provides a generated configuration at `./ssrl-example/ssrl.config.json`
that reads synthetic Markdown only, with **no write permissions**.
Point your MCP-capable chat client's **stdio server command** at `ssrl-node`
and pass the **absolute path** to that config file as its argument.
Then call `context.compile` for `Project Atlas deadline`; the authorized
synthetic result contains **2026-11-20**. Your client may require a
separate model account, but the MCP server itself does not.

Use the explicit [configuration guide](docs/local-node-runtime-v1.md)
before authorizing access to real files. Windows and Linux registry installs
plus MCP tool calls passed with synthetic data; independent human onboarding
and production suitability remain **unverified**.

See [installation and client setup](docs/preview-install.md).

## Run the demo

Requirements: **Node.js 24.12+** and **pnpm 12.14.0**. From a fresh clone:

~~~bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:handoff
~~~

The demo uses synthetic Markdown/SQLite data and **two actual MCP SDK
client sessions**. Its output shows the stale value, trusted value,
`state.plan`/`state.apply` reconciliation, restarted runtime, authorized
`context.compile` answer, and privacy checks. Package installation may use
the network; **the demo itself requires no API key or external model**.

[Walk through the real observed output](examples/SHOWCASE.md).

## Use it as an MCP server

For a source-built alternative, see [the source-based Developer Preview installer](docs/preview-install.md).
It builds a production-only installation at an explicit final path; the
source-based Windows installation cannot safely be moved afterward. The
**published npm package is standalone**, separate from that limitation.

Maintainers can still build a **private local npm tarball** using
`pnpm preview:pack -- <new-staging-directory>` and verify it with
`pnpm test:preview-pack`. The public prerelease is available on npm;
**the MCP Registry listing and a stable consumer release are not available**.

When running a local source build instead, after creating
an explicit configuration file using the
[local runtime guide](docs/local-node-runtime-v1.md), start the server with:

~~~bash
node packages/node-app/dist/cli.js ./ssrl.config.json
~~~

`./ssrl.config.json` is **your own file**, not an included ready-made
production config. Use explicit source mappings, principal scopes, field
policies and local paths. The server does not silently discover user files.
Point your MCP-capable client's **stdio command and arguments** at the
built CLI and that config; each chat client has a different config format.

| MCP tool | What it does |
| --- | --- |
| `state.plan` | Computes a bounded proposed change based on source authority and preconditions. |
| `state.apply` | Applies an approved proposal only within configured write permissions. |
| `context.compile` | Returns current, policy-scoped semantic context within a bounded token budget. |

**Start read-only.** Grant only `state:read` and `context:read` when a client
needs retrieval, and disable writable field policies and plan/apply. The
[first-run OpenCode setup](examples/README.md#opencode-v2-first-use-local-mcp)
creates such a **temporary synthetic** read-only workspace automatically:

~~~bash
pnpm demo:chat-setup
~~~

The setup is offline; an actual hosted-model chat request requires a
separate, explicit developer API key and network access.

## Verified AI client integrations

**OpenCode v2.3.0** and **Goose CLI v1.59.0** each made a real
`context.compile` MCP call and returned the correct authorized deadline
from synthetic data. They are two independently tested chat applications,
**not** two independently hosted model providers: both used the same NVIDIA
developer gateway on one Windows host. These tests do **not** establish
physical cross-device synchronization or readiness for real user data.

See [OpenCode and Goose examples](examples/README.md) and the separate
[live two-model handoff](examples/README.md#optional-two-live-llm-models-using-the-same-mcp-state).

## Project status

- **Ready to try:** published npm Developer Preview (`next`),
  read-only synthetic first-run, local build, deterministic demo, stdio MCP
  integration and regression tests.
- **Not yet delivered:** independently validated human onboarding,
  MCP Registry distribution, or a supported stable consumer release.
- **License:** [MIT](LICENSE), copyright (c) 2026 Osman Aslan. Reuse and
  distribution are permitted under the license's notice requirements.
- **Participation:** read [Contributing](CONTRIBUTING.md) and
  [Security](SECURITY.md). Security issues can be reported privately.

## Architecture and implementation

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

The runtime is a Developer Preview, not a consumer product. Important remaining work includes:

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
