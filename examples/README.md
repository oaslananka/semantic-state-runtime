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
