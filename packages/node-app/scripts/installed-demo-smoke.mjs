import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const cli = process.env.SSRL_TEST_CLI_PATH;
const configFile = process.env.SSRL_TEST_CONFIG_PATH;
if (!cli || !configFile) throw new Error("Provide installed CLI and synthetic demo config paths.");
const config = JSON.parse(await readFile(configFile, "utf8"));
assert.deepEqual(config.principal.scopes, ["state:read", "context:read"]);
assert.deepEqual(config.policy.operations, { plan: false, apply: false });
assert.equal(config.policy.fields.every((grant) => grant.write === false), true);

for (let i = 0; i < 2; i++) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(cli), resolve(configFile)],
    stderr: "pipe",
  });
  const client = new Client({ name: "ssrl-published-preview-smoke", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "context.compile"));
    const result = await client.callTool({
      name: "context.compile",
      arguments: { task: "Project Atlas deadline", budgetTokens: 180 },
    });
    assert.notEqual(result.isError, true);
    const text = (result.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n");
    assert.match(text, /2026-11-20/);
    const apply = await client.callTool({
      name: "state.apply",
      arguments: { entityId: "entity://project/atlas", proposalDigest: "invalid" },
    });
    assert.equal(apply.isError, true);
  } finally {
    await client.close();
  }
}
console.log("Installed synthetic read-only MCP demo passed two independent sessions.");
