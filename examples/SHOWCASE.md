# First 90 seconds: one fact, two MCP clients

**The problem:** Project Atlas's local Markdown copy still says November 15.
The trusted source says November 20. Which deadline should a new agent use
after the first agent has finished`

## 1. Run the real local scenario

From a clean clone (Node.js 24.12+, pnpm 12.x):

~~~bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:handoff
~~~

The first installation and compilation depend on the machine and may take
longer than 90 seconds. The interactive walkthrough after setup is short.
No login, account, API key, Docker or cloud service is needed. The
package installation may fetch dependencies, but the MCP demo itself
makes no external requests.

## 2. Read the observed result

The script checks actual synthetic files before and after applying MCP
operations and reads the second client's real `context.compile` response:

~~~text
Project Atlas (synthetic local MCP handoff)
BEFORE    Local copy's deadline: 2026-11-15
AUTHORITY Trusted source's deadline: 2026-11-20
AGENT A   MCP state.plan -> state.apply: 2026-11-20
CHECK     Unrelated local content was preserved.
RESTART   Agent A disconnected; Agent B started a fresh MCP runtime.
AGENT B   MCP context.compile: 2026-11-20
PRIVACY   Policy-denied evidence was not returned.
PASS      Durable, policy-scoped state across two MCP SDK clients.
~~~

These lines are produced from live values and verified tool responses in the
test fixture; a failure causes a nonzero exit rather than a misleading
success line. The original source and writable replica are synthetic.

## 3. Understand what was proven

| Step | Why it matters |
| --- | --- |
| Before and authority | A stale copy cannot silently win over the trusted source. |
| Agent A | A genuine MCP `state.plan` / `state.apply` flow corrects the writable copy while preserving unrelated data. |
| Restart | Agent A exits; Agent B connects to a new MCP runtime process against the same durable local state. |
| Agent B | MCP `context.compile` returns the authorized current deadline, also in model-readable text. |
| Privacy | Restricted source fields remain in the source fixture but are absent from the returned MCP context. |

## 4. Try optional live model interactions

Run `pnpm demo:chat-setup` to prepare a disposable, read-only local MCP
workspace and receive a ready-to-run **OpenCode v2.3.0** command. Real
inference requires an existing NVIDIA Build developer API key and network.
The setup command itself makes no model request. The separate
`pnpm demo:llm-handoff` uses two live model families behind the same
NVIDIA gateway; see [all model examples](README.md).

A second independent chat CLI, **Goose v1.59.0**, was also verified with one
actual SSRL MCP context call and a final authorized answer. Its
[configuration and evidence](README.md#second-chat-client-goose-cli-verified)
are documented separately. Neither chat app is installed or invoked by
the default deterministic demo.

**Evidence boundary:** Two MCP SDK clients in the default demo and two
separately tested real AI chat CLIs. All used synthetic local data. This is
not physical cross-device sync, independent model-provider hosting, human
user research, or a tested production deployment.
