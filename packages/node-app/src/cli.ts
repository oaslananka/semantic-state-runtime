#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  InvalidLocalAppConfigError,
  loadAndCreateLocalRuntimeApp,
} from "./index.js";

function startupError(error: unknown): string[] {
  if (error instanceof InvalidLocalAppConfigError) {
    return [
      "Invalid SSRL configuration:",
      ...error.issues.map((issue) => `- ${issue}`),
    ];
  }
  if (error instanceof Error) {
    return [`SSRL startup failed: ${error.name}`];
  }
  return ["SSRL startup failed."];
}

async function main(argv: readonly string[]): Promise<void> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    console.log([
      "Usage: ssrl-node <config.json>",
      "       ssrl-node --help",
      "       ssrl-node --version",
      "",
      "Start a local, policy-scoped MCP server over stdio using an explicit config file.",
      "See docs/local-node-runtime-v1.md for the configuration guide.",
      "Try the synthetic two-client demo from the repository root: pnpm demo:handoff",
    ].join("\n"));
    return;
  }

  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-V")) {
    const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    console.log("ssrl-node " + metadata.version);
    return;
  }

  if (argv.length !== 1 || argv[0]?.startsWith("-")) {
    console.error("Usage: ssrl-node <config.json>");
    process.exitCode = 2;
    return;
  }

  let loaded: Awaited<ReturnType<typeof loadAndCreateLocalRuntimeApp>>;
  try {
    loaded = await loadAndCreateLocalRuntimeApp(argv[0]!);
  } catch (error) {
    for (const line of startupError(error)) console.error(line);
    process.exitCode = 1;
    return;
  }

  for (const warning of loaded.warnings) {
    console.error(`SSRL warning: ${warning}`);
  }

  const handle = serveStdio(
    () => loaded.app.createMcpServer(),
    {
      legacy: "serve",
      onerror: () => {
        console.error("SSRL MCP transport error.");
      },
    },
  );

  let closing: Promise<void> | undefined;
  const shutdown = (exitCode?: number): Promise<void> => {
    if (closing !== undefined) return closing;
    closing = (async () => {
      try {
        await handle.close();
      } finally {
        loaded.app.close();
        if (exitCode !== undefined) process.exitCode = exitCode;
      }
    })();
    return closing;
  };

  process.once("SIGINT", () => {
    void shutdown(130);
  });
  process.once("SIGTERM", () => {
    void shutdown(143);
  });
  process.stdin.once("end", () => {
    void shutdown();
  });
  process.once("exit", () => {
    loaded.app.close();
  });
}

await main(process.argv.slice(2));
