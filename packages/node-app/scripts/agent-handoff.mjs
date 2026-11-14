import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHandoffFixture } from "./handoff-fixture.mjs";

const { entityId, replica, connect, close } = await createHandoffFixture();

try {
  // Agent A reconciles a stale writable replica against the authoritative note.
  const agentA = await connect("agent-a");
  try {
    const proposal = await agentA.callTool({ name: "state.plan", arguments: { entityId } });
    assert.notEqual(proposal.isError, true);
    const digest = proposal.structuredContent?.proposalDigest;
    assert.match(digest, /^sha256:[a-f0-9]{64}$/);
    const applied = await agentA.callTool({
      name: "state.apply",
      arguments: { entityId, proposalDigest: digest },
    });
    assert.notEqual(applied.isError, true);
    const replicaText = await readFile(join(replica, "project.md"), "utf8");
    assert.match(replicaText, /deadline: "2026-11-20"/);
    assert.match(replicaText, /unrelated: keep/);
    assert.match(replicaText, /REPLICA-ONLY-SECRET/);
    console.log("Agent A: reconciled the stale project deadline to 2026-11-20.");
  } finally {
    await agentA.close();
  }

  // Agent B is a distinct MCP client in a freshly started runtime process.
  const agentB = await connect("agent-b");
  try {
    const result = await agentB.callTool({
      name: "context.compile",
      arguments: { task: "What is the current Project Atlas deadline?", budgetTokens: 180 },
    });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent?.resolution?.status, "resolved");
    assert.equal(result.structuredContent?.resolution?.entityId, entityId);
    const serialized = JSON.stringify(result);
    assert.match(serialized, /2026-11-20/);
    assert.equal(serialized.includes("PRIVATE-EVIDENCE"), false);
    assert.equal(serialized.includes("REPLICA-ONLY-SECRET"), false);
    console.log("Agent B: retrieved the current deadline (2026-11-20) after runtime restart.");
    console.log("Access policy: private evidence was not disclosed.");
  } finally {
    await agentB.close();
  }

  console.log("PASS: two independent MCP clients used one durable, policy-scoped semantic state.");
} finally {
  await close();
}
