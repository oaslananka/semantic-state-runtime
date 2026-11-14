import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const installer = join(repository, "scripts/preview-install.mjs");
const e2e = join(repository, "packages/node-app/scripts/stdio-e2e.mjs");
const root = await mkdtemp(join(tmpdir(), "ssrl-preview-install-smoke-"));
const initial = join(root, "runtime");
const relocated = join(root, "runtime-relocated");

function run(args, options = {}) {
  const proc = spawnSync(process.execPath, args, {
    cwd: repository,
    env: { ...process.env, ...options.env },
    stdio: options.expectFailure ? "pipe" : "inherit",
    encoding: "utf8",
    timeout: 240_000,
  });
  if (proc.error) throw proc.error;
  return proc;
}

function verify(path) {
  const result = run([e2e], { env: { SSRL_TEST_CLI_PATH: join(path, "dist/cli.js") } });
  assert.equal(result.status, 0, "Installed server failed real stdio MCP calls");
}

try {
  const installation = run([installer, initial]);
  assert.equal(installation.status, 0, "Preview installation did not complete");
  const manifest = JSON.parse(await readFile(join(initial, "package.json"), "utf8"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.license, "MIT");
  const notice = await readFile(join(initial, "LICENSE"), "utf8");
  assert.match(notice, /^MIT License\n/);
  assert.match(notice, /Copyright \(c\) 2026 Osman Aslan/);
  assert.match(await readFile(join(initial, "docs/local-node-runtime-v1.md"), "utf8"), /Local Node runtime v1/);
  assert.match(await readFile(join(initial, "docs/preview-install.md"), "utf8"), /Developer Preview/);
  const overwrite = run([installer, initial], { expectFailure: true });
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /Destination already exists; refusing to overwrite/);

  verify(initial);
  if (process.platform !== "win32") {
    await rename(initial, relocated);
    verify(relocated);
    console.log("Linux/macOS preview relocation: passed real stdio MCP calls");
  } else {
    console.log("Windows preview: final-directory MCP calls passed; relocation is unsupported");
  }
  console.log("Preview installation and policy-scoped MCP acceptance passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
