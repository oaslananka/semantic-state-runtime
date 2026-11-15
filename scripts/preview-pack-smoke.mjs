import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { npmDistTag } from "./release-version.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const packager = join(repository, "scripts/preview-pack.mjs");
const e2e = join(repository, "packages/node-app/scripts/stdio-e2e.mjs");
const root = await mkdtemp(join(tmpdir(), "ssrl-npm-preview-smoke-"));
const stage = join(root, "stage");
const consumer = join(root, "consumer");

function runNode(args, options = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: options.cwd ?? repository,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    timeout: 240_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "Node command failed: " + args.join(" ") + "\n" + (result.stderr ?? ""));
  return result.stdout;
}

function npm(args, cwd, capture = false) {
  const candidates = [
    join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    join(dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const cli = candidates.find(existsSync);
  if (!cli && process.platform === "win32") throw new Error("Node.js npm CLI not found");
  const executable = cli ? process.execPath : "npm";
  const result = spawnSync(executable, cli ? [cli, ...args] : args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "npm command failed: " + args.join(" ") + "\n" + (result.stderr ?? ""));
  return result.stdout;
}

function packMetadata(cwd, destination, name) {
  const output = JSON.parse(npm(["pack", "--json", "--pack-destination", destination], cwd, true));
  // npm 11 returns an array; npm 12 returns an object keyed by package name.
  const metadata = Array.isArray(output) ? output[0] : output?.[name];
  assert.ok(metadata && typeof metadata.filename === "string", "npm pack metadata must identify a tarball");
  assert.ok(Array.isArray(metadata.files), "npm pack must list packaged files");
  return metadata;
}

try {
  assert.equal(npmDistTag("0.1.0-beta.2"), "next");
  assert.equal(npmDistTag("0.1.0"), "latest");
  assert.throws(() => npmDistTag("0.1.0-dev"), /Expected a stable SemVer/);
  runNode([packager, stage]);
  const manifest = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
  assert.equal(manifest.private, true, "Preview must not be publishable");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.name, "semantic-state-runtime");
  assert.deepEqual(manifest.dependencies ?? {}, {}, "All workspace dependencies must be bundled");
  assert.deepEqual(manifest.optionalDependencies ?? {}, {});
  assert.equal(Object.values(manifest).some((value) => typeof value === "string" && value.includes("file:///")), false);

  const packed = packMetadata(stage, root, manifest.name);
  const tarball = join(root, packed.filename);
  await mkdir(consumer);

  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", consumer, tarball], consumer);
  const installed = join(consumer, "node_modules/semantic-state-runtime");
  const installedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(installedManifest.private, true);
  assert.equal(installedManifest.license, "MIT");
  assert.equal(installedManifest.version, manifest.version);
  assert.match(await readFile(join(installed, "LICENSE"), "utf8"), /^MIT License/);
  assert.match(await readFile(join(installed, "README.md"), "utf8"), /Public npm MCP release/);
  const cli = join(installed, "dist/cli.js");
  runNode([cli, "--help"], { cwd: consumer });
  runNode([cli, "--version"], { cwd: consumer });
  npm(["exec", "--offline", "--no", "--", "ssrl-node", "--help"], consumer);
  runNode([e2e], { cwd: consumer, env: { SSRL_TEST_CLI_PATH: cli } });
  assert.match(await readFile(join(installed, "THIRD_PARTY_NOTICES.txt"), "utf8"), /LICENSES/);

  const releaseStage = join(root, "release-stage");
  const releaseConsumer = join(root, "release-consumer");
  const example = join(root, "synthetic-example");
  runNode([packager, "--publishable", releaseStage]);
  const releaseManifest = JSON.parse(await readFile(join(releaseStage, "package.json"), "utf8"));
  assert.equal(releaseManifest.private, false);
  assert.equal(releaseManifest.version, manifest.version);
  assert.equal(releaseManifest.name, "semantic-state-runtime");
  const registry = JSON.parse(await readFile(join(repository, "server.json"), "utf8"));
  assert.equal(registry.name, "io.github.oaslananka/semantic-state-runtime");
  assert.equal(registry.version, releaseManifest.version);
  assert.equal(registry.packages[0].version, releaseManifest.version);
  assert.equal(registry.packages[0].identifier, releaseManifest.name);
  assert.equal(registry.packages[0].packageArguments[0].type, "positional");
  assert.equal(registry.packages[0].packageArguments[0].valueHint, "configPath");
  assert.equal(registry.packages[0].packageArguments[0].isRequired, true);
  assert.equal(releaseManifest.mcpName, registry.name);
  assert.equal(releaseManifest.license, "MIT");
  assert.equal(releaseManifest.publishConfig.tag, npmDistTag(releaseManifest.version));
  assert.match(releaseManifest.repository.url, /github\.com\/oaslananka\/semantic-state-runtime/);
  assert.deepEqual(releaseManifest.dependencies ?? {}, {});
  assert.match(await readFile(join(releaseStage, "THIRD_PARTY_NOTICES.txt"), "utf8"), /LICENSES/);
  // npm publish --dry-run refuses already published immutable versions.
  // The release workflow performs a guarded dry-run only for new versions;
  // this reusable CI smoke validates packing, files and offline installation.
  const releasePacked = packMetadata(releaseStage, root, releaseManifest.name);
  const paths = releasePacked.files.map((f) => f.path);
  assert.ok(paths.includes("THIRD_PARTY_NOTICES.txt"));
  assert.ok(paths.includes("bin/demo-init.mjs"));
  assert.ok(paths.includes("docs/connect-project.md"));
  assert.ok(paths.includes("dist/project-cli.js"), "Project connector must ship in npm tarball");
  assert.ok(!paths.some((path) => /\.npmrc|\.env|\.git|node_modules|\.sqlite/.test(path)));
  await mkdir(releaseConsumer);
  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", releaseConsumer, join(root, releasePacked.filename)], releaseConsumer);
  const releaseInstalled = join(releaseConsumer, "node_modules/semantic-state-runtime");
  const entry = join(releaseInstalled, "dist/cli.js");
  const demoInit = join(releaseInstalled, "bin/demo-init.mjs");
  npm(["exec", "--offline", "--no", "--", "ssrl-demo-init", example], releaseConsumer);
  const demoConfig = JSON.parse(await readFile(join(example, "ssrl.config.json"), "utf8"));
  assert.deepEqual(demoConfig.principal.scopes, ["state:read", "context:read"]);
  assert.deepEqual(demoConfig.policy.operations, { plan: false, apply: false });
  const opencode = JSON.parse(await readFile(join(example, "opencode.json"), "utf8"));
  const copilot = JSON.parse(await readFile(join(example, "copilot.mcp-config.json"), "utf8"));
  const local = opencode.mcp?.servers?.ssrl;
  const portable = copilot.mcpServers?.ssrl;
  assert.equal(local?.type, "local");
  assert.deepEqual(opencode.permissions, [
    { action: "*", resource: "*", effect: "deny" },
    { action: "ssrl_context_compile", resource: "*", effect: "allow" },
  ]);
  assert.equal(local?.command?.[0], process.execPath);
  assert.equal(local?.command?.[1], entry);
  assert.equal(local?.command?.[2], join(example, "ssrl.config.json"));
  assert.ok(local.command.every(isAbsolute), "OpenCode command and paths must be absolute");
  assert.equal(portable?.command, process.execPath);
  assert.deepEqual(portable?.args, local.command.slice(1));
  assert.deepEqual(copilot.mcpServers.ssrl.env ?? {}, {});
  assert.deepEqual(demoConfig.principal.scopes, ["state:read", "context:read"]);
  const rerun = spawnSync(process.execPath, [demoInit, example], { encoding: "utf8", cwd: releaseConsumer });
  assert.notEqual(rerun.status, 0, "A second setup must not overwrite the workspace");
  assert.match(rerun.stderr, /already exists/);
  runNode([join(repository, "packages/node-app/scripts/installed-demo-smoke.mjs")], {
    cwd: releaseConsumer,
    env: { SSRL_TEST_CLI_PATH: entry, SSRL_TEST_CONFIG_PATH: join(example, "ssrl.config.json") },
  });
  runNode([demoInit, "--help"], { cwd: releaseConsumer });
  const connector = join(releaseInstalled, "dist/project-cli.js");
  runNode([connector, "--help"], { cwd: releaseConsumer });
  const selectedProject = join(root, "selected-project");
  const connectedWorkspace = join(root, "connected-workspace");
  await mkdir(selectedProject);
  await writeFile(join(selectedProject, "README.md"), "# Sample project\\nINITIAL_PROJECT_DECISION\\n".replaceAll("\\n", "\n"));
  // A person starting inside the project must get a sibling workspace without an --out flag.
  runNode([connector, ".", "--local-only"], { cwd: selectedProject });
  assert.equal(existsSync(join(root, "ssrl-selected-project", "ssrl.config.json")), true);
  runNode([connector, selectedProject, "--local-only", "--out", connectedWorkspace], { cwd: releaseConsumer });
  runNode([connector, "--refresh", connectedWorkspace], { cwd: releaseConsumer });
  const connectedConfig = JSON.parse(await readFile(join(connectedWorkspace, "ssrl.config.json"), "utf8"));
  const antigravity = JSON.parse(await readFile(join(connectedWorkspace, ".agents/mcp_config.json"), "utf8"));
  const copilotConnected = JSON.parse(await readFile(join(connectedWorkspace, "copilot.mcp-config.json"), "utf8"));
  assert.deepEqual(antigravity.mcpServers.ssrl, copilotConnected.mcpServers.ssrl);
  assert.equal(connectedConfig.principal.scopes.includes("state:write"), false);
  assert.equal(connectedConfig.policy.operations.apply, false);
  assert.equal(connectedConfig.providers.length, 1);
  runNode([join(repository, "packages/node-app/scripts/installed-project-smoke.mjs")], {
    cwd: releaseConsumer,
    env: {
      SSRL_TEST_CLI_PATH: entry,
      SSRL_TEST_CONNECTED_WORKSPACE: connectedWorkspace,
      SSRL_TEST_CONNECTED_SOURCE: selectedProject,
    },
  });
  assert.equal((await readFile(join(selectedProject, "README.md"), "utf8")).includes("UPDATED_PROJECT_DECISION"), true);

  console.log("Unpublished npm " + npmDistTag(releaseManifest.version) + "-tag candidate and read-only installed MCP first-run PASS");
  console.log("Offline npm tarball installation and installed MCP tool calls passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
