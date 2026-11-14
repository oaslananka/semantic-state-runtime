import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHandoffFixture } from "./handoff-fixture.mjs";

function deadlineInFile(markdown) {
  const match = /^deadline:\s*"(\d{4}-\d{2}-\d{2})"\s*$/m.exec(markdown);
  assert.ok(match, "The synthetic fixture must contain a dated deadline.");
  return match[1];
}

const { entityId, replica, primary, connect, close } = await createHandoffFixture();

try {
  const replicaBeforeText = await readFile(join(replica, "project.md"), "utf8");
  const before = deadlineInFile(replicaBeforeText);
  assert.match(replicaBeforeText, /unrelated: keep/);
  const authoritative = deadlineInFile(await readFile(join(primary, "project.md"), "utf8"));
  assert.notEqual(before, authoritative, "The demo needs a genuinely outdated replica.");

  console.log("Project Atlas (synthetic local MCP handoff)");
  console.log("BEFORE    Local copy's deadline: " + before);
  console.log("AUTHORITY Trusted source's deadline: " + authoritative);

  // Agent A plans and applies the correction using real MCP tools.
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
    const after = deadlineInFile(replicaText);
    assert.equal(after, authoritative);
    assert.match(replicaText, /unrelated: keep/);
    assert.match(replicaText, /REPLICA-ONLY-SECRET/);

    console.log("AGENT A   MCP state.plan -> state.apply: " + after);
    console.log("CHECK     Unrelated local content was preserved.");
  } finally {
    await agentA.close();
  }

  // Agent B is a different MCP client attached to a new runtime process.
  const agentB = await connect("agent-b");
  try {
    console.log("RESTART   Agent A disconnected; Agent B started a fresh MCP runtime.");
    const result = await agentB.callTool({
      name: "context.compile",
      arguments: { task: "What is the current Project Atlas deadline?", budgetTokens: 180 },
    });
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent?.resolution?.status, "resolved");
    assert.equal(result.structuredContent?.resolution?.entityId, entityId);

    const record = result.structuredContent?.records?.find(
      (item) => item.entityId === entityId &&
        item.kind === "state" &&
        item.text.includes("Project.deadline"),
    );
    const deadline = record?.text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    assert.equal(deadline, authoritative, "Agent B must read the authoritative current value.");

    const visibleText = (result.content ?? [])
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    assert.ok(visibleText.includes(deadline), "The MCP response must be readable to chat clients.");

    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("PRIVATE-EVIDENCE"), false);
    assert.equal(serialized.includes("REPLICA-ONLY-SECRET"), false);

    console.log("AGENT B   MCP context.compile: " + deadline);
    console.log("PRIVACY   Policy-denied evidence was not returned.");
  } finally {
    await agentB.close();
  }

  console.log("PASS      Durable, policy-scoped state across two MCP SDK clients.");
} finally {
  await close();
}
