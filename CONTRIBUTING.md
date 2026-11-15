# Contributing to Semantic State Runtime

This repository is an **unreleased developer preview** under the
[GNU GPL v3.0](LICENSE). Contributions must be compatible with that license;
do not submit third-party code or content without permission to license it.
No npm or MCP Registry package has been published yet.

## Start here

- Read [the README](README.md) and the
  [90-second demo](examples/SHOWCASE.md).
- Read [semantic invariants](docs/invariants.md) before changing state,
  permissions, replication, identity or write behavior.
- See [repository agent instructions](AGENTS.md) and relevant
  package-specific instructions under `packages/`.

## Making changes

1. Open or reuse a focused GitHub issue for a reproducible bug or a
   proposed improvement; confirm the issue is not already tracked.
2. Keep one coherent fix in one PR. Include user-visible behavior,
   focused tests, and any public-contract changes.
3. Use synthetic test inputs. Never commit credentials, personal source
   data, tokens, private artifacts or internal workstation details.
4. Keep documentation and PR/issue text in English.

## Local verification

~~~bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:stdio
pnpm demo:handoff
pnpm test:chat-setup
~~~

CI and existing security/quality checks are the merge acceptance gates.
Do not bypass failed or pending checks.

For suspected vulnerabilities, follow [SECURITY.md](SECURITY.md) instead
of publishing exploit details in a public issue.
