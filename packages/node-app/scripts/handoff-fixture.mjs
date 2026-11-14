import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

function manifest(id, writable) {
  const access = writable ? ["read", "write"] : ["read"];
  return {
    schemaVersion: "0.1",
    id,
    displayName: id,
    capabilities: {
      read: true, write: writable, observe: true, subscribe: false,
      revisions: "opaque", idempotency: "none",
    },
    entities: [{
      canonicalType: "Project",
      externalType: "markdown",
      fields: ["deadline", "secret"].map((property) => ({
        canonical: "Project." + property,
        external: property,
        access,
      })),
    }],
  };
}

export async function createHandoffFixture() {
  const entityId = "entity://project/atlas";
  const root = await mkdtemp(join(tmpdir(), "ssrl-agent-handoff-"));
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const configPath = join(root, "config.json");
  const primary = join(root, "primary");
  const replica = join(root, "replica");


  const sources = ["primary", "replica"];
  const config = {
    schemaVersion: "1",
    journalPath: "./journal/runtime.sqlite",
    context: {
      semanticStatePath: "./context/semantic.sqlite",
      ingestionStatePath: "./context/ingestion.sqlite",
      artifactStoreRoot: "./context/artifacts",
      sources: sources.map((provider) => ({ provider, externalType: "markdown" })),
      maxBudgetTokens: 512,
    },
    principal: {
      subject: "user:demo",
      scopes: ["state:read", "state:write", "context:read"],
    },
    providers: sources.map((id) => ({
      id, root: "./" + id, manifest: manifest(id, id === "replica"),
    })),
    entities: [{
      entityId,
      aliases: ["Project Atlas", "Atlas"],
      bindings: sources.map((provider) => ({
        provider, externalId: "project.md", canonicalType: "Project",
      })),
      authority: ["deadline", "secret"].map((property) => ({
        property: "Project." + property, provider: "primary",
      })),
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

  return {
    entityId, root, replica, primary, connect,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
