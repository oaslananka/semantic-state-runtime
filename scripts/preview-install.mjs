import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repository, command, pnpm, requireNewDestination } from "./preview-utils.mjs";

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

  const destination = await requireNewDestination(
    args[0],
    "Choose a final installation directory outside the source repository.",
  );

  const packageJson = JSON.parse(await readFile(join(repository, "packages/node-app/package.json"), "utf8"));
  if (packageJson.private !== true) throw new Error("Preview installer requires the MCP workspace to remain private.");

  pnpm(["build"]);
  pnpm(["--filter", "@ssrl/node-app", "deploy", "--prod", destination]);

  // The deployed private workspace package does not inherit the root GPL-3.0-only license.
  await copyFile(join(repository, "LICENSE"), join(destination, "LICENSE"));
  await mkdir(join(destination, "docs"), { recursive: true });
  for (const name of ["local-node-runtime-v1.md", "preview-install.md"]) {
    await copyFile(join(repository, "docs", name), join(destination, "docs", name));
  }
  const installedManifest = join(destination, "package.json");
  const manifest = JSON.parse(await readFile(installedManifest, "utf8"));
  manifest.license = "GPL-3.0-only";
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
