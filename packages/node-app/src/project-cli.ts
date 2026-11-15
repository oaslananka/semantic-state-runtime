#!/usr/bin/env node
import { lstat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { connectProject, refreshProject, type ConnectionResult } from "./project-connect.js";

function usage(): void {
  console.log("Usage: ssrl-connect <existing-folder|github-url|owner/repo> [--out new-folder] [--github owner/repo] [--local-only]");
  console.log("       ssrl-connect --refresh <connected-workspace>");
  console.log("Connect one project read-only. Create an isolated workspace without modifying the source.");
  console.log("GitHub is read via HTTPS on demand. Anonymous public reads or existing GH_TOKEN/GITHUB_TOKEN are supported.");
}

interface CliArguments {
  readonly input: string;
  readonly destination?: string;
  readonly github?: string;
  readonly localOnly: boolean;
}

function parseConnectionOptions(args: readonly string[]): CliArguments {
  const input = args[0]!;
  let destination: string | undefined;
  let github: string | undefined;
  let localOnly = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--local-only") {
      localOnly = true;
      continue;
    }
    if (arg !== "--out" && arg !== "--github") {
      throw new Error("Unknown option: " + arg + ". Use --help.");
    }
    const next = args[++i];
    if (!next || next.startsWith("-")) {
      throw new Error("Missing value for " + arg + ". Use --help.");
    }
    if (arg === "--out") destination = next;
    else github = next;
  }
  if (localOnly && github) throw new Error("Choose either --github or --local-only.");
  return {
    input,
    ...(destination === undefined ? {} : { destination }),
    ...(github === undefined ? {} : { github }),
    localOnly,
  };
}

async function outputDirectory(options: CliArguments): Promise<string> {
  if (options.destination) return resolve(options.destination);
  const source = resolve(options.input);
  let isFolder = false;
  try {
    const info = await lstat(source);
    isFolder = info.isDirectory() && !info.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (isFolder) return join(dirname(source), "ssrl-" + basename(source));

  const name = options.input.replace(/\/$/, "").split(/[\\/]/).at(-1)!.replace(/\.git$/i, "");
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60) || "project";
  return resolve("ssrl-" + safe);
}

function reportConnection(result: ConnectionResult): void {
  console.log("SSRL connected: " + (result.githubRepo ?? basename(result.localRoot!)));
  console.log("Workspace: " + result.workspace);
  console.log("Read-only project documents: README/ROADMAP/CHANGELOG/TODO and up to 20 docs Markdown files.");
  console.log(result.githubRepo
    ? "GitHub open issues and PRs: on-demand updates (five minutes without a token; one minute with an existing token)."
    : "Local-only mode: no GitHub network requests.");
  console.log("OpenCode: open the workspace folder; opencode.json is ready.");
  console.log("Antigravity: open the workspace folder; .agents/mcp_config.json is ready.");
  console.log("Copilot: merge the ssrl entry from copilot.mcp-config.json into your own global MCP config.");
  console.log("Ask: Use SSRL context.compile to show the current open issues and relevant project decisions.");
  console.log("No existing repository file, global client config or GitHub issue was modified.");
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    usage();
    return;
  }
  if (args.length === 2 && args[0] === "--refresh") {
    await refreshProject(join(resolve(args[1]!), "project.json"), { force: true });
    console.log("SSRL project sources refreshed. The original project was not changed.");
    return;
  }
  if (args.length === 0 || args[0]!.startsWith("-")) {
    usage();
    process.exitCode = 2;
    return;
  }
  const options = parseConnectionOptions(args);
  const destination = await outputDirectory(options);
  const result = await connectProject(options.input, {
    destination,
    ...(options.github === undefined ? {} : { github: options.github }),
    autoDetectGithub: !options.localOnly,
  });
  reportConnection(result);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error("SSRL connection failed: " + (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
}
