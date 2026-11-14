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

OpenCode **v2.3.0** was tested against a real local SSRL stdio process and a
synthetic, authorized Project Atlas context fixture. Its model consumed the
authorized deadline through the MCP text fallback and answered **2026-11-20**.
The app's built-in MCP display may initially report no servers on a cold
start; check the actual chat tool invocation rather than assuming success
from the registration listing.

After building SSRL and preparing an explicit local runtime configuration
(see `docs/local-node-runtime-v1.md`), put the following
NaNopencode.json` in the **chat workspace**, not in the SSRL source tree.
Replace the two absolute paths with your own authorized runtime locations
(and escape backslashes if using Windows JSON paths):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": { "servers": {
    "ssrl": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/ssrl/packages/node-app/dist/cli.js",
        "/absolute/path/to/your-ssrl-config.json"
      ],
      "codemode": false
    }
  } },
  "permissions": [
    { "action": "ssrl_context_compile", "resource": "*", "effect": "allow" },
    { "action": "ssrl_state_plan", "resource": "*", "effect": "deny" },
    { "action": "ssrl_state_apply", "resource": "*", "effect": "deny" }
  ]
}
```

Use an existing, free NVIDIA Build API key exported as `NVIDIA_API_KEY`.
Run the CLI in the chat workspace (not in the SSRL source checkout):

```bash
opencode run --standalone --model nvidia/nvidia/nemotron-3.5-lightning-30b-a3b "Call ssrl_context_compile with budgetTokens 180 to read the current authorized Project Atlas deadline. Use the tool result, not a guess."
```

These example permissions allow **read-only** context access; state
planning/application tools are intentionally denied. No raw notes or
credentials belong in chat prompts or repository config. The result
depends on the entities and policies in your actual SSRL runtime config.
This checks one chat app and one NVIDIA-hosted model, **not** cross-device
sync, separate model providers, or independent human-user acceptance.
