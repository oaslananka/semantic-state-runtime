import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

try {
  runNode([packager, stage]);
  const manifest = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
  assert.equal(manifest.private, true, "Preview must not be publishable");
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.name, "semantic-state-runtime");
  assert.deepEqual(manifest.dependencies ?? {}, {}, "All workspace dependencies must be bundled");
  assert.deepEqual(manifest.optionalDependencies ?? {}, {});
  assert.equal(Object.values(manifest).some((value) => typeof value === "string" && value.includes("file:///")), false);

  const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", root], stage, true));
  assert.equal(packed.length, 1);
  const tarball = join(root, packed[0].filename);
  await mkdir(consumer);

  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", consumer, tarball], consumer);
  const installed = join(consumer, "node_modules/semantic-state-runtime");
  const installedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
  assert.equal(installedManifest.private, true);
  assert.equal(installedManifest.license, "MIT");
  assert.equal(installedManifest.version, manifest.version);
  assert.match(await readFile(join(installed, "LICENSE"), "utf8"), /^MIT License/);
  assert.match(await readFile(join(installed, "README.md"), "utf8"), /Developer Preview/);
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
  assert.equal(releaseManifest.version, "0.1.0-beta.1");
  assert.equal(releaseManifest.name, "semantic-state-runtime");
  assert.equal(releaseManifest.license, "MIT");
  assert.equal(releaseManifest.publishConfig.tag, "next");
  assert.match(releaseManifest.repository.url, /github\.com\/oaslananka\/semantic-state-runtime/);
  assert.deepEqual(releaseManifest.dependencies ?? {}, {});
  assert.match(await readFile(join(releaseStage, "THIRD_PARTY_NOTICES.txt"), "utf8"), /LICENSES/);
  npm(["publish", "--dry-run", "--tag", "next", "--access", "public", "--json"], releaseStage, true);
  const releasePacked = JSON.parse(npm(["pack", "--json", "--pack-destination", root], releaseStage, true));
  assert.equal(releasePacked.length, 1);
  const paths = releasePacked[0].files.map((f) => f.path);
  assert.ok(paths.includes("THIRD_PARTY_NOTICES.txt"));
  assert.ok(paths.includes("bin/demo-init.mjs"));
  assert.ok(!paths.some((path) => /\.npmrc|\.env|\.git|node_modules|\.sqlite/.test(path)));
  await mkdir(releaseConsumer);
  npm(["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", releaseConsumer, join(root, releasePacked[0].filename)], releaseConsumer);
  const releaseInstalled = join(releaseConsumer, "node_modules/semantic-state-runtime");
  const entry = join(releaseInstalled, "dist/cli.js");
  const demoInit = join(releaseInstalled, "bin/demo-init.mjs");
  npm(["exec", "--offline", "--no", "--", "ssrl-demo-init", example], releaseConsumer);
  const demoConfig = JSON.parse(await readFile(join(example, "ssrl.config.json"), "utf8"));
  assert.deepEqual(demoConfig.principal.scopes, ["state:read", "context:read"]);
  assert.deepEqual(demoConfig.policy.operations, { plan: false, apply: false });
  runNode([join(repository, "packages/node-app/scripts/installed-demo-smoke.mjs")], {
    cwd: releaseConsumer,
    env: { SSRL_TEST_CLI_PATH: entry, SSRL_TEST_CONFIG_PATH: join(example, "ssrl.config.json") },
  });
  runNode([demoInit, "--help"], { cwd: releaseConsumer });
  console.log("Unpublished npm next-tag candidate and read-only installed MCP first-run PASS");
  console.log("Offline npm tarball installation and installed MCP tool calls passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
