# Security Policy

## Supported versions

Semantic State Runtime is currently an **unreleased developer preview**.
There is no supported production version, published package or guarantee
of a vulnerability response/service-level time.

## Report a vulnerability privately

Use the GitHub repository's
[Security Advisories](https://github.com/oaslananka/semantic-state-runtime/security/advisories) page and select
**Report a vulnerability**. Private vulnerability reporting is enabled
for this repository. Do not post exploit details, tokens, real user data
or unredacted logs in public issues or PRs.

Include a concise impact statement, affected commit/version, safe
reproduction steps and any mitigations known. Synthetic reproductions
are preferred. The maintainer will review reports when possible; no
formal response timeline is promised.

## Scope

Authorization, identity resolution, policy-scoped context, mutation
preconditions, cryptographic handling and MCP transport boundaries are
security-sensitive. See [invariants](docs/invariants.md) and the
[MCP adapter contract](docs/mcp-adapter-v1.md).

**Developer preview is not a security certification.** Existing synthetic
tests and CI cannot prove production security for arbitrary deployments.
