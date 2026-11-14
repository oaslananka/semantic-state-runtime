import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const entityId = "entity://project/atlas";
const root = await mkdtemp(join(tmpdir(), "ssrl-agent-handoff-"));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const configPath = join(root, "config.json");
const primary = join(root, "primary");
const replica = join(root, "replica");

function manifest(id, writable) {
  return {
    schemaVersion: "0.1",
    id,
    displayName: id,
    capabilities: {
      read: true,
      write: writable,
      observe: true,
      subscribe: false,
      revisions: "opaque",
      idempotency: "none",
    },
    entities: [{
      canonicalType: "Project",
      externalType: "markdown",
      fields: [
        { canonical: "Project.deadline", external: "deadline", access: writable ? ["read", "write"] : ["read"] },
        { canonical: "Project.secret", external: "secret", access: writable ? ["read", "write"] : ["read"] },
      ],
    }],
  };
}

const config = {
  schemaVersion: "1",
  journalPath: "./journal/runtime.sqlite",
  context: {
    semanticStatePath: "./context/semantic.sqlite",
    ingestionStatePath: "./context/ingestion.sqlite",
    artifactStoreRoot: "./context/artifacts",
    sources: [
      { provider: "primary", externalType: "markdown" },
      { provider: "replica", externalType: "markdown" },
    ],
    maxBudgetTokens: 512,
  },
  principal: { subject: "user:demo", scopes: ["state:read", "state:write", "context:read"] },
  providers: [
    { id: "primary", root: "./primary", manifest: manifest("primary", false) },
    { id: "replica", root: "./replica", manifest: manifest("replica", true) },
  ],
  entities: [{
    entityId,
    aliases: ["Project Atlas", "Atlas"],
    bindings: [
      { provider: "primary", externalId: "project.md", canonicalType: "Project" },
      { provider: "replica", externalId: "project.md", canonicalType: "Project" },
    ],
    authority: [
      { property: "Project.deadline", provider: "primary" },
      { property: "Project.secret", provider: "primary" },
    ],
  }],
  policy: {
    operations: { plan: true, apply: true },
    fields: [{ entityId, property: "Project.deadline", read: true, write: true }],
  },
};

async function connect(agentName) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, configPath],
    cwd: root,
    stderr: "pipe",
  });
  const client = new Client({ name: agentName, version: "1.0.0" });
  await client.connect(transport);
  return client;
}

try {
  await access(cli);
  await Promise.all([mkdir(primary), mkdir(replica)]);
  await writeFile(
    join(primary, "project.md"),
    '---\ndeadline: "2026-11-20"\nsecret: "PRIVATE-EVIDENCE"\n---\n# Authorized source\n',
    "utf8",
  );
  await writeFile(
    join(replica, "project.md"),
    '---\ndeadline: "2026-11-15"\nsecret: "REPLICA-ONLY-SECRET"\nunrelated: keep\n---\n# Replica\n',
    "utf8",
  );
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

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
  await rm(root, { recursive: true, force: true });
}
