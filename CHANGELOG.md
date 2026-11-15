# Changelog

## [0.3.3](https://github.com/oaslananka/semantic-state-runtime/compare/v0.3.2...v0.3.3) (2026-11-15)


### MCP client compatibility

* Connected projects now accept context requests up to the existing 4,096-token gateway limit, allowing a 2,000-token Codex retry without enabling writes. Requests above that limit remain denied.

### Bug Fixes

* align connected project context budget with gateway limit ([#156](https://github.com/oaslananka/semantic-state-runtime/issues/156)) ([bf40eb9](https://github.com/oaslananka/semantic-state-runtime/commit/bf40eb99cdeee409d36c4085ee4ece9acc70cb90))

## [0.3.2](https://github.com/oaslananka/semantic-state-runtime/compare/v0.3.1...v0.3.2) (2026-11-15)


### Onboarding

* Public GitHub connections can recover from anonymous API quota exhaustion through an already-authenticated local GitHub CLI. SSRL does not extract, log or save CLI tokens, and unrelated access-denied requests still fail closed.

### Bug Fixes

* use existing GitHub CLI when anonymous API quota is exhausted ([#153](https://github.com/oaslananka/semantic-state-runtime/issues/153)) ([8883c6e](https://github.com/oaslananka/semantic-state-runtime/commit/8883c6e952abe82b2d49ca262ca40070ff2daf21))

## [0.3.1](https://github.com/oaslananka/semantic-state-runtime/compare/v0.3.0...v0.3.1) (2026-11-15)


### Licensing

* Project-authored source is now distributed under GPL-3.0-only. Previously published versions retain their original license terms; see [LICENSING.md](LICENSING.md).

### Bug Fixes

* explain GitHub API access failures during onboarding ([#149](https://github.com/oaslananka/semantic-state-runtime/issues/149)) ([3c70612](https://github.com/oaslananka/semantic-state-runtime/commit/3c706126b89b455d4af59852ca28a33e82a738eb))
* resolve connected projects by README title ([#151](https://github.com/oaslananka/semantic-state-runtime/issues/151)) ([a74a272](https://github.com/oaslananka/semantic-state-runtime/commit/a74a272ec5002ab0359b2a658395ba60f09720c9))

## [0.3.0](https://github.com/oaslananka/semantic-state-runtime/compare/v0.2.0...v0.3.0) (2026-11-15)


### Features

* connect real projects with read-only live context ([#145](https://github.com/oaslananka/semantic-state-runtime/issues/145)) ([#146](https://github.com/oaslananka/semantic-state-runtime/issues/146)) ([aa32a7f](https://github.com/oaslananka/semantic-state-runtime/commit/aa32a7f84061c6b0a99abffb034eeb6d5dcd99f9))

## [0.2.0](https://github.com/oaslananka/semantic-state-runtime/compare/v0.1.0...v0.2.0) (2026-11-15)


### Features

* simplify MCP onboarding and prepare verified Registry publishing ([#142](https://github.com/oaslananka/semantic-state-runtime/issues/142)) ([0cbdc8d](https://github.com/oaslananka/semantic-state-runtime/commit/0cbdc8dedc35aec8815a3943af4a7d517fbf291e))

## [0.1.0](https://github.com/oaslananka/semantic-state-runtime/compare/v0.1.0-beta.2...v0.1.0) (2026-11-15)


### Features

* integrate Release Please with stable npm OIDC publishing ([#138](https://github.com/oaslananka/semantic-state-runtime/issues/138)) ([e1fb881](https://github.com/oaslananka/semantic-state-runtime/commit/e1fb881595d75daa9c6082f2fcb3dc2ae15ef2c0))
