import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repository = fileURLToPath(new URL("../", import.meta.url));

function within(parent, target) {
  const rel = relative(parent, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

function run(executable, args, cwd = repository) {
  const result = spawnSync(executable, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Command exited with status " + (result.status ?? result.signal));
  }
}

function buildWorkspace() {
  const runner = process.env.npm_execpath;
  if (!runner || !/pnpm/i.test(runner)) {
    throw new Error("Use the pinned package manager: pnpm preview:pack -- <new-directory>.");
  }
  const js = /\\.(?:c?js|mjs)$/i.test(runner);
  run(js ? process.execPath : runner, js ? [runner, "build"] : ["build"]);
}

async function packagePreview(argv) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: pnpm preview:pack -- <new-directory>");
    console.log("Build a private, locally packable npm preview; nothing is published.");
    return;
  }
  if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
    throw new Error("Provide one new staging directory outside the source repository.");
  }
  const destination = resolve(args[0]);
  if (within(repository, destination)) {
    throw new Error("The npm preview staging directory must be outside the source repository.");
  }
  const existing = await lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing) throw new Error("Destination already exists; refusing to overwrite: " + destination);

  const workspace = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const nodeApp = JSON.parse(await readFile(join(repository, "packages/node-app/package.json"), "utf8"));
  if (workspace.private !== true || nodeApp.private !== true || workspace.license !== "MIT") {
    throw new Error("Public packaging preflight requires private workspaces and the MIT license.");
  }

  buildWorkspace();
  await mkdir(destination);
  try {
    await mkdir(join(destination, "dist"));
    await build({
      entryPoints: [join(repository, "packages/node-app/dist/cli.js")],
      outfile: join(destination, "dist/cli.js"),
      platform: "node",
      format: "esm",
      target: "node24",
      bundle: true,
      legalComments: "external",
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: "warning",
    });

    const manifest = {
      name: "semantic-state-runtime",
      version: nodeApp.version,
      private: true,
      description: "Unreleased local MCP Developer Preview of Semantic State Runtime",
      license: "MIT",
      type: "module",
      engines: { node: ">=24.12.0" },
      bin: { "ssrl-node": "./dist/cli.js" },
      files: ["dist/", "LICENSE", "README.md", "docs/"],
    };
    await writeFile(join(destination, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    await copyFile(join(repository, "LICENSE"), join(destination, "LICENSE"));
    await mkdir(join(destination, "docs"));
    await copyFile(
      join(repository, "docs/local-node-runtime-v1.md"),
      join(destination, "docs/local-node-runtime-v1.md"),
    );
    await writeFile(
      join(destination, "README.md"),
      "# Semantic State Runtime — local npm preview\n\n" +
        "This is a **private, unpublished Developer Preview artifact**, not a released npm package.\n" +
        "Run the installed MCP server with `ssrl-node <config.json>`.\n" +
        "See [configuration](docs/local-node-runtime-v1.md) and [upstream source](https://github.com/oaslananka/semantic-state-runtime).\n",
    );
    run(process.execPath, [join(destination, "dist/cli.js"), "--help"], destination);
    console.log("Private npm preview ready: " + destination);
    console.log("Run npm pack from this directory; do not publish this preview.");
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

try {
  await packagePreview(process.argv.slice(2));
} catch (error) {
  console.error("SSRL npm preview packaging failed: " + (error instanceof Error ? error.message : "unknown error"));
  process.exitCode = 1;
}
