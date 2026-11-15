# Connect a real project in one command

SSRL is a **read-only project context source** for MCP-capable AI agents. Connect a folder or public GitHub repository once; when the agent requests current context, SSRL verifies the selected local Markdown and refreshes GitHub metadata within a bounded interval.

## Quickstart: an existing public GitHub repository

Requires Node.js 24.12+ and a compatible MCP client (OpenCode is verified). No SSRL account, API key, cloud server or paid provider is needed to read public GitHub metadata.

~~~bash
npm install -g semantic-state-runtime
ssrl-connect https://github.com/oaslananka/semantic-state-runtime
cd ssrl-semantic-state-runtime
opencode
~~~

Ask OpenCode:

> Use SSRL context.compile for oaslananka/semantic-state-runtime. Which GitHub issues are currently open? Include issue numbers and source links. Do not guess from old notes.

The generated workspace includes ready-to-use opencode.json for OpenCode, .agents/mcp_config.json for Google Antigravity IDE/CLI, and a copilot.mcp-config.json entry for VS Code Copilot Global. Antigravity's local workspace configuration format is documented at https://antigravity.google/docs/mcp. The Antigravity format is schema-checked against the generated Copilot-compatible stdio configuration; interactive Antigravity agent acceptance is still separate. **Merge the latter entry** into your existing config; never replace other configured servers. Both launch the same installed ssrl-node with an absolute project.json path. Other MCP clients can use the same command/arguments but their client configuration format must be checked independently.

## Connect an existing local project

~~~bash
ssrl-connect ./my-project --out ./my-project-ssrl
~~~

SSRL reads your selected folder without writing into the repo. If its Git remote origin points to github.com, the connector also discovers and reads that repository's GitHub issue and PR metadata. Use --local-only to prevent remote detection and **any GitHub network requests**; use --github owner/repo to choose a specific GitHub source:

~~~bash
ssrl-connect ./my-project --local-only --out ./my-project-ssrl
ssrl-connect ./my-project --github owner/repo --out ./my-project-ssrl
~~~

Every command refuses an existing output directory. The local workspace must be outside the selected source folder. No global client config is edited.

## Automatic, bounded source verification

- **Local Markdown:** top-level README.md, ROADMAP.md, CHANGELOG.md, TODO.md and up to 20 Markdown documents under docs/ (limited nesting). Files are rechecked on every authorized context.compile call; added and changed allowed documents become available without reconfiguring the project.
- **Limits are visible:** only short excerpts (up to 1,100 characters per file) enter the context projection. Documents over 64 KiB are skipped and labeled. Beyond 20 selected Markdown documents, the workspace reports the selection limit rather than implying full coverage. Hidden files and symbolic links are excluded.
- **GitHub:** only the public/authorized repository's metadata and up to 20 recent open issue and PR titles, numbers and links are fetched. Issue and PR bodies are not ingested. The lists are bounded API windows, **not guaranteed full counts**.
- **Refresh timing:** on demand with context.compile, no daemon or background worker. Anonymous GitHub access is rate-limited and refreshed no more frequently than every five minutes per workspace. An existing GH_TOKEN or GITHUB_TOKEN in the user's environment supports one-minute checks; credentials are never written into project files. For an explicit fresh check, run ssrl-connect --refresh ./ssrl-my-project.
- **Freshness failure:** a failed required GitHub refresh is reported as an error. SSRL does not silently call a previously fetched snapshot current.

Original local documents and GitHub issues/PRs are never changed by SSRL. The generated local historical issue-ID snapshot is intentionally retained. If GitHub issues change later, it can be compared with the current, GitHub-authoritative Project.openIssueIds: this is a real, traceable source difference, not a made-up project deadline. The actual displayed data is always policy-scoped through the existing SSRL Context Plane.

## When public GitHub access is rate-limited

Public GitHub API requests have a shared per-IP anonymous rate limit. If `ssrl-connect` reports HTTP 403/429, check its message for a rate-limit reset time, then retry; GitHub may also deny access for other reasons. If you already have an authorized GitHub token, expose it **only in your own shell** through `GH_TOKEN` or `GITHUB_TOKEN` and rerun; never paste credentials into SSRL project files or chat. For a local folder, `--local-only` connects selected Markdown without GitHub requests. SSRL does **not** silently present earlier issue/PR metadata as current when a required refresh fails.

## How to verify the product benefit

1. Connect a real public repository with an open GitHub issue.
2. Have an MCP client retrieve open issue numbers with context.compile. Record the answer and its source.
3. When that issue is later **actually closed in GitHub**, use the same workspace and ask again after the refresh interval, or run ssrl-connect --refresh.
4. Compare the initial offline snapshot with the new authorized result. The offline snapshot still mentions the issue; live GitHub and SSRL no longer report it as open.
5. Re-open the same workspace from another MCP client. Confirm it sees the same updated issue status; count wrong answers, repeated manual prompts and setup steps.

A deterministic two-session SDK smoke and an actual OpenCode model/tool call verify **specific** scenarios, not independent end-user success. A comparison that deliberately feeds stale data to an agent is illustrative rather than a general benchmark. The public GitHub API may be temporarily unavailable or rate-limited. Authenticated HTTP, private data and production use require separate acceptance. No ChatGPT/Claude web app is deployed.

See the source-based runtime guide for advanced explicit field permissions: [Local Node runtime](local-node-runtime-v1.md).
