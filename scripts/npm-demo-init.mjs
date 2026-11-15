#!/usr/bin/env node
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const entityId = "entity://project/atlas";

function manifest() {
  return {
    schemaVersion: "0.1",
    id: "source",
    displayName: "Synthetic read-only source",
    capabilities: {
      read: true, write: false, observe: true, subscribe: false,
      revisions: "opaque", idempotency: "none",
    },
    entities: [{
      canonicalType: "Project",
      externalType: "markdown",
      fields: [{
        canonical: "Project.deadline", external: "deadline", access: ["read"],
      }],
    }],
  };
}

function exampleConfig() {
  return {
    schemaVersion: "1",
    journalPath: "./state/runtime.sqlite",
    context: {
      semanticStatePath: "./state/semantic.sqlite",
      ingestionStatePath: "./state/ingestion.sqlite",
      artifactStoreRoot: "./state/artifacts",
      sources: [{ provider: "source", externalType: "markdown" }],
      maxBudgetTokens: 512,
    },
    principal: {
      subject: "user:synthetic-demo",
      scopes: ["state:read", "context:read"],
    },
    providers: [{ id: "source", root: "./source", manifest: manifest() }],
    entities: [{
      entityId,
      aliases: ["Project Atlas", "Atlas"],
      bindings: [{
        provider: "source", externalId: "project.md", canonicalType: "Project",
      }],
      authority: [{ property: "Project.deadline", provider: "source" }],
    }],
    policy: {
      operations: { plan: false, apply: false },
      fields: [{
        entityId, property: "Project.deadline", read: true, write: false,
      }],
    },
  };
}

async function main(args) {
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    console.log("Usage: ssrl-demo-init <new-directory>");
    console.log("Create a synthetic, read-only MCP workspace. Refuses existing directories.");
    return;
  }
  if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
    throw new Error("Provide one new directory. Example: ssrl-demo-init ./ssrl-example");
  }
  const destination = resolve(args[0]);
  const old = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (old !== undefined) throw new Error("Destination already exists; refusing to overwrite.");
  await mkdir(destination);
  try {
    await mkdir(join(destination, "source"));
    await writeFile(
      join(destination, "source", "project.md"),
      '---\ndeadline: "2026-11-20"\n---\n# Project Atlas (synthetic data)\n',
    );
    await writeFile(
      join(destination, "ssrl.config.json"),
      JSON.stringify(exampleConfig(), null, 2) + "\n",
    );
    const configPath = join(destination, "ssrl.config.json");
    // These launch the exact locally installed npm package, without PATH or
    // shared-user configuration changes. Only synthetic read-only data is used.
    const command = [
      process.execPath,
      fileURLToPath(new URL("../dist/cli.js", import.meta.url)),
      configPath,
    ];
    await writeFile(join(destination, "opencode.json"), JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: { servers: { ssrl: { type: "local", command, cwd: destination } } },
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "ssrl_context_compile", resource: "*", effect: "allow" },
      ],
    }, null, 2) + "\n");
    await writeFile(join(destination, "copilot.mcp-config.json"), JSON.stringify({
      mcpServers: { ssrl: { command: command[0], args: command.slice(1) } },
    }, null, 2) + "\n");
    console.log("Synthetic read-only workspace created: " + destination);
    console.log("Connect an MCP stdio client to: ssrl-node " +
      JSON.stringify(join(destination, "ssrl.config.json")));
    console.log("OpenCode: open the generated directory and launch OpenCode there; opencode.json is ready.");
    console.log("VS Code Copilot: in Chat > Open Customizations > MCP Servers, copy the ssrl entry from:");
    console.log("  " + join(destination, "copilot.mcp-config.json"));
    console.log("Add it to your own Copilot Global config (do not replace existing servers).");
    console.log("Ask the client to call context.compile for Project Atlas deadline.");
    console.log("This demo does not access your existing files or enable writes.");
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error("SSRL demo setup failed: " + (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
}
