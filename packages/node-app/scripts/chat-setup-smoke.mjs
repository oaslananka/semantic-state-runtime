import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { cleanupChatWorkspace, prepareChatWorkspace } from "./chat-setup.mjs";

test("fresh chat workspace is read-only, authorized, and cleanly disposable", async () => {
  const root = await prepareChatWorkspace();
  try {
    const opencode = JSON.parse(await readFile(join(root, "opencode.json"), "utf8"));
    const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
    assert.deepEqual(config.principal.scopes, ["state:read", "context:read"]);
    assert.deepEqual(config.policy.operations, { plan: false, apply: false });
    assert.deepEqual(opencode.permissions, [
      { action: "*", resource: "*", effect: "deny" },
      { action: "ssrl_context_compile", resource: "*", effect: "allow" },
    ]);
    assert.equal(opencode.providers.nvidia.settings.apiKey, "{env:NVIDIA_API_KEY}");
    assert.equal(JSON.stringify(opencode).includes("PRIVATE-EVIDENCE"), false);
    assert.equal(JSON.stringify(opencode).includes("REPLICA-ONLY-SECRET"), false);

    const replica = await readFile(join(root, "replica", "project.md"), "utf8");
    assert.match(replica, /deadline: "2026-11-20"/);
    assert.match(replica, /unrelated: keep/);

    const connection = new StdioClientTransport({
      command: opencode.mcp.servers.ssrl.command[0],
      args: opencode.mcp.servers.ssrl.command.slice(1),
      cwd: opencode.mcp.servers.ssrl.cwd,
      stderr: "pipe",
    });
    const client = new Client({ name: "first-run-smoke", version: "1.0.0" });
    try {
      await client.connect(connection);
      const result = await client.callTool({
        name: "context.compile",
        arguments: { task: "Project Atlas deadline", budgetTokens: 180 },
      });
      assert.notEqual(result.isError, true);
      assert.equal(result.structuredContent?.resolution?.status, "resolved");
      assert.match(JSON.stringify(result.content), /2026-11-20/);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE-EVIDENCE|REPLICA-ONLY-SECRET/);

      const denied = await client.callTool({
        name: "state.apply",
        arguments: {
          entityId: "entity://project/atlas",
          proposalDigest: "sha256:" + "0".repeat(64),
        },
      });
      assert.equal(denied.isError, true);
    } finally {
      await client.close();
    }
  } finally {
    await cleanupChatWorkspace(root);
  }
  await assert.rejects(stat(root), { code: "ENOENT" });
});

test("cleanup rejects arbitrary paths", async () => {
  await assert.rejects(
    cleanupChatWorkspace(process.cwd()),
    /Refusing to delete anything outside/,
  );
});
