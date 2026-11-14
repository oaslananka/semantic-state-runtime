import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));

function within(parent, target) {
  const rel = relative(parent, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

function command(executable, args, cwd = repository) {
  const result = spawnSync(executable, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Command exited with status " + (result.status ?? result.signal));
  }
}

function pnpm(args) {
  const runner = process.env.npm_execpath;
  if (!runner) {
    throw new Error("Run through the pinned package manager: pnpm preview:install -- <final-directory>.");
  }
  const js = /\.(?:c?js|mjs)$/i.test(runner);
  command(js ? process.execPath : runner, js ? [runner, ...args] : args);
}

async function install(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log("Usage: pnpm preview:install -- <final-directory>");
    console.log("Build and install an unreleased local MCP runtime to a new directory.");
    return;
  }
  if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
    throw new Error("Provide one final destination: pnpm preview:install -- <final-directory>.");
  }

  const destination = resolve(args[0]);
  if (within(repository, destination)) {
    throw new Error("Choose a final installation directory outside the source repository.");
  }
  const existing = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing) throw new Error("Destination already exists; refusing to overwrite: " + destination);

  const packageJson = JSON.parse(await readFile(join(repository, "packages/node-app/package.json"), "utf8"));
  if (packageJson.private !== true) throw new Error("Preview installer requires the MCP workspace to remain private.");

  pnpm(["build"]);
  pnpm(["--filter", "@ssrl/node-app", "deploy", "--prod", destination]);

  // The deployed private workspace package does not inherit the root MIT license.
  await copyFile(join(repository, "LICENSE"), join(destination, "LICENSE"));
  await mkdir(join(destination, "docs"), { recursive: true });
  for (const name of ["local-node-runtime-v1.md", "preview-install.md"]) {
    await copyFile(join(repository, "docs", name), join(destination, "docs", name));
  }
  const installedManifest = join(destination, "package.json");
  const manifest = JSON.parse(await readFile(installedManifest, "utf8"));
  manifest.license = "MIT";
  await writeFile(installedManifest, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const cli = join(destination, "dist/cli.js");
  command(process.execPath, [cli, "--help"], destination);
  console.log("SSRL preview installed at: " + destination);
  console.log('Stdio MCP command: node "' + cli + '" "<your-config.json>"');
  console.log("No package or hosted service was published.");
  if (process.platform === "win32") {
    console.log("Windows: install at the final directory; moving pnpm junctions breaks this runtime. Reinstall to change location.");
  }
}

try {
  await install(process.argv.slice(2));
} catch (error) {
  console.error("SSRL preview installation failed: " + (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
}
