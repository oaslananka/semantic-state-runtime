import assert from "node:assert/strict";
import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandoffFixture } from "./handoff-fixture.mjs";

const markerFile = ".ssrl-chat-demo-created";
const markerValue = "ssrl-synthetic-opencode-demo-v1";
const entityId = "entity://project/atlas";
const model = "nvidia/nvidia/nemotron-3.5-lightning-30b-a3b";
const prompt =
  "Call ssrl_context_compile with task 'Project Atlas deadline' and budgetTokens 180. " +
  "Answer the authorized current YYYY-MM-DD deadline from the MCP tool result, not a guess.";

export async function prepareChatWorkspace() {
  const fixture = await createHandoffFixture();
  const { root, connect, close } = fixture;
  try {
    // Reconcile once to seed a durable state for the chat application's read-only session.
    const seed = await connect("setup-reconciliation");
    try {
      const plan = await seed.callTool({ name: "state.plan", arguments: { entityId } });
      assert.notEqual(plan.isError, true);
      const digest = plan.structuredContent?.proposalDigest;
      assert.match(digest, /^sha256:[a-f0-9]{64}$/);
      const applied = await seed.callTool({
        name: "state.apply",
        arguments: { entityId, proposalDigest: digest },
      });
      assert.notEqual(applied.isError, true);
    } finally {
      await seed.close();
    }

    // OpenCode is given a read-only server principal, not just a UI-level permission.
    const serverConfigPath = join(root, "config.json");
    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8"));
    serverConfig.principal.scopes = ["state:read", "context:read"];
    serverConfig.policy.operations = { plan: false, apply: false };
    serverConfig.policy.fields = serverConfig.policy.fields.map((grant) => ({
      ...grant,
      write: false,
    }));
    await writeFile(serverConfigPath, JSON.stringify(serverConfig, null, 2) + "\n");

    const opencodeConfig = {
      $schema: "https://opencode.ai/config.json",
      model,
      providers: {
        nvidia: { settings: { apiKey: "{env:NVIDIA_API_KEY}" } },
      },
      mcp: {
        servers: {
          ssrl: {
            type: "local",
            command: [
              process.execPath,
              fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
              serverConfigPath,
            ],
            cwd: root,
            codemode: false,
          },
        },
      },
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "ssrl_context_compile", resource: "*", effect: "allow" },
      ],
    };
    await writeFile(join(root, "opencode.json"), JSON.stringify(opencodeConfig, null, 2) + "\n");
    await writeFile(join(root, markerFile), markerValue + "\n");
    return root;
  } catch (error) {
    await close();
    throw error;
  }
}

export async function cleanupChatWorkspace(directory) {
  const path = resolve(directory);
  const temp = resolve(tmpdir());
  if (dirname(path) !== temp || !basename(path).startsWith("ssrl-agent-handoff-")) {
    throw new Error("Refusing to delete anything outside a direct SSRL temporary fixture.");
  }
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) {
    throw new Error("Refusing to delete a non-directory or redirected fixture.");
  }
  const marker = await readFile(join(path, markerFile), "utf8");
  if (marker.trim() !== markerValue) {
    throw new Error("Refusing to delete an unrecognized fixture.");
  }
  await rm(path, { recursive: true, force: false });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 0) {
      const root = await prepareChatWorkspace();
      console.log("PASS: isolated synthetic SSRL chat workspace is ready.");
      console.log("Workspace: " + root);
      console.log("OpenCode v2.3.0 or newer, with an existing NVIDIA Build key in NVIDIA_API_KEY:");
      console.log('  cd "' + root + '"');
      console.log('  npx --yes @opencode/cli@2.3.0 run --standalone --model ' + model + ' "' + prompt + '"');
      console.log("The existing MCP server principal is read-only; no real files were imported.");
      console.log("To remove this generated workspace from the repository root:");
      console.log('  pnpm demo:chat-setup --cleanup "' + root + '"');
    } else if (args.length === 2 && args[0] === "--cleanup") {
      await cleanupChatWorkspace(args[1]);
      console.log("PASS: isolated synthetic SSRL chat workspace removed.");
    } else {
      console.error("Usage: pnpm demo:chat-setup [--cleanup <generated-workspace>]");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error("Chat setup failed: " + (error instanceof Error ? error.message : "unknown error"));
    process.exitCode = 1;
  }
}
