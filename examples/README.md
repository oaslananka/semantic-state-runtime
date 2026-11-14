# Two-agent semantic state handoff

This runnable, deterministic demo shows **two different MCP SDK clients** using the same local Semantic State Runtime, one after the other. It is **not** a demo of two live LLM vendors, cloud sync, or production-grade user onboarding.

## Run

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:handoff
```

The script creates temporary synthetic Markdown project notes and local SQLite state, then:

1. **Agent A** uses the real MCP `state.plan` / `state.apply` tools to reconcile a stale writable copy of a deadline against the authoritative source.
2. It closes that MCP session. A new runtime process starts for **Agent B**, which uses the real `context.compile` tool to retrieve the resulting current project deadline.
3. Assertions verify the value, preservation of unrelated source content, and non-disclosure of policy-denied secret fields.

All storage is temporary and cleaned up. The script uses no API keys, external LLMs, paid services, or cloud infrastructure.

**Evidence boundary:** This proves a local, sequential MCP-client handoff and restart persistence in one deterministic fixture. It does **not** prove cross-device encrypted replication, real multi-model interoperability, real-user task success, or retrieval accuracy on external datasets.

## Optional: two live LLM models using the same MCP state

The second demo makes **four real inference calls** to two different model families through NVIDIA's hosted, free developer endpoint: **Nemotron 3.5 Bolt E4B** (Agent A) and **Mistral Large 4** (Agent B). Each agent creates a new MCP client/session against the actual built local SSRL stdio server. Agent A's model-generated tool calls plan and apply the reconciliation; after the runtime restarts, Agent B's model-generated call fetches context and its model answers the deadline question. The orchestrator enforces exact entity/digest preconditions and never sends raw project files or policy-denied fields to the inference service.

Use a NVIDIA Build API key with access to these **free endpoints**. Set `NVIDIA_API_KEY` in your shell, but never commit or paste the value into the repository. No credentials are required for the default deterministic demo.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:llm-handoff
```

The live demo uses synthetic records, temporary local SQLite/Markdown files, four bounded requests (no automatic retry), and cleans up afterward. API availability and provider free-tier terms can change; this is not a guarantee that other endpoints or higher-volume usage are free.

To exercise **the same MCP wiring without an API key or network access**, run `pnpm test:llm-handoff`. That smoke test uses stubbed model responses: it does **not** prove external inference.

**Evidence boundary:** Two distinct live model families are tested behind the **same NVIDIA gateway**, not two independent hosted providers, not two separately installed chat apps, and not cross-device sync. Real external user data and production access are intentionally excluded.

## OpenCode v2 first-use (local MCP)

From the repository root, prepare the **synthetic** isolated chat workspace:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm demo:chat-setup
```

This prints a temporary workspace path, a ready-to-run OpenCode command,
and a matching cleanup command. You do not need to write MCP JSON, select
a project folder, grant real-file permissions, or provide an API key just
to prepare the demo.

The setup first reconciles a stale synthetic deadline, then reduces the
persistent SSRL server principal to **read-only** access. The generated
OpenCode client permits only the `ssrl_context_compile` tool.

To ask a real model, set an existing NVIDIA Build free developer key as
`NVIDIA_API_KEY` in your shell and run the printed command. It
uses the tested `@opencode/cli@2.3.0` without altering an
existing global OpenCode installation. A model API key and network are
required for inference; availability and free-tier rules may change.
The setup script itself makes **no external LLM requests**.

The model must call `ssrl_context_compile` and answer
`2026-11-20` based on the authorized MCP tool output. If the record
is absent, that is a failure rather than permission to guess.

Remove the generated workspace with the exact cleanup command printed
during setup. Cleanup refuses paths outside its own verified fixture.
Run `pnpm test:chat-setup` to check local MCP read/deny and
cleanup behaviors entirely offline (without real model inference).

This demo proves one local chat-app integration with synthetic records.
It is not a two-app certification, physical cross-device sync,
production onboarding, or evidence about real personal data.
For your own data, see `docs/local-node-runtime-v1.md`.
