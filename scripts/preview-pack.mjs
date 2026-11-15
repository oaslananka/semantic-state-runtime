import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { repository, command, pnpm, requireNewDestination } from "./preview-utils.mjs";
import { npmDistTag } from "./release-version.mjs";

async function collectThirdPartyNotices(metafile) {
  const roots = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const normalized = input.replaceAll("\\", "/");
    const match = /^(.*?node_modules\/\.pnpm\/[^/]+\/node_modules\/(?:@[^/]+\/)?[^/]+)/.exec(normalized);
    if (match) roots.add(resolve(repository, match[1]));
  }
  const notices = await Promise.all([...roots]
    .sort((a, b) => a.localeCompare(b, "en"))
    .map(async (root) => {
      const data = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
      const files = await readdir(root);
      const licenseFile = files.find((name) => /^(?:license|licence|copying)(?:[.-].*)?$/i.test(name));
      if (!licenseFile) throw new Error("Cannot verify bundled third-party license: " + data.name);
      return "=== " + data.name + "@" + data.version + " ===\n" +
        (await readFile(join(root, licenseFile), "utf8")).trim();
    }));
  if (roots.size === 0) throw new Error("No bundled third-party dependency inventory discovered.");
  return "THIRD-PARTY SOFTWARE LICENSES\n\n" + notices.join("\n\n") + "\n";
}

async function packagePreview(argv) {
  const publishable = argv[0] === "--publishable";
  const remaining = publishable ? argv.slice(1) : argv;
  const args = remaining[0] === "--" ? remaining.slice(1) : remaining;
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log("Usage: pnpm preview:pack -- <new-directory>");
    console.log(publishable ? "Stage a public npm release candidate without publishing." : "Build a private, locally packable npm preview; nothing is published.");
    return;
  }
  if (args.length !== 1 || !args[0] || args[0].startsWith("-")) {
    throw new Error("Provide one new staging directory outside the source repository.");
  }
  const destination = await requireNewDestination(
    args[0],
    "The npm preview staging directory must be outside the source repository.",
  );

  const workspace = JSON.parse(await readFile(join(repository, "package.json"), "utf8"));
  const nodeApp = JSON.parse(await readFile(join(repository, "packages/node-app/package.json"), "utf8"));
  if (workspace.private !== true || nodeApp.private !== true || workspace.license !== "MIT") {
    throw new Error("Public packaging preflight requires private workspaces and the MIT license.");
  }
  if (workspace.version !== nodeApp.version) {
    throw new Error("Root release version must match the bundled MCP source version.");
  }

  // Reject ambiguous versions before any package output is staged.
  const releaseTag = npmDistTag(nodeApp.version);
  const registry = JSON.parse(await readFile(join(repository, "server.json"), "utf8"));
  if (nodeApp.mcpName !== registry.name || registry.version !== nodeApp.version ||
      registry.packages?.[0]?.identifier !== "semantic-state-runtime" ||
      registry.packages?.[0]?.version !== nodeApp.version) {
    throw new Error("MCP Registry name, package or version differs from the npm source.");
  }

  pnpm(["build"]);
  await mkdir(destination);
  try {
    await mkdir(join(destination, "dist"));
    const bundle = await build({
      entryPoints: [join(repository, "packages/node-app/dist/cli.js")],
      outfile: join(destination, "dist/cli.js"),
      platform: "node",
      format: "esm",
      target: "node24",
      bundle: true,
      legalComments: "linked",
      metafile: true,
      banner: {
        js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
      logLevel: "warning",
    });

    await writeFile(join(destination, "THIRD_PARTY_NOTICES.txt"), await collectThirdPartyNotices(bundle.metafile));
    await mkdir(join(destination, "bin"));
    await copyFile(join(repository, "scripts/npm-demo-init.mjs"), join(destination, "bin/demo-init.mjs"));
    await chmod(join(destination, "bin/demo-init.mjs"), 0o755);

    const manifest = {
      name: "semantic-state-runtime",
      mcpName: nodeApp.mcpName,
      version: nodeApp.version,
      private: !publishable,
      description: "Policy-authorized semantic context for AI agents through MCP",
      repository: { type: "git", url: "git+https://github.com/oaslananka/semantic-state-runtime.git" },
      homepage: "https://github.com/oaslananka/semantic-state-runtime#readme",
      bugs: { url: "https://github.com/oaslananka/semantic-state-runtime/issues" },
      keywords: ["mcp", "mcp-server", "ai-agents", "semantic-state", "source-authority", "sqlite"],
      license: "MIT",
      type: "module",
      engines: { node: ">=24.12.0" },
      bin: { "ssrl-node": "dist/cli.js", "ssrl-demo-init": "bin/demo-init.mjs" },
      ...(publishable ? { publishConfig: {
        tag: releaseTag, registry: "https://registry.npmjs.org/", access: "public",
      } } : {}),
      files: ["dist/", "bin/", "LICENSE", "THIRD_PARTY_NOTICES.txt", "README.md", "docs/"],
    };
    await writeFile(join(destination, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    await copyFile(join(repository, "LICENSE"), join(destination, "LICENSE"));
    await mkdir(join(destination, "docs"));
    await copyFile(
      join(repository, "docs/local-node-runtime-v1.md"),
      join(destination, "docs/local-node-runtime-v1.md"),
    );
    await writeFile(join(destination, "README.md"), "# Semantic State Runtime\n\n**Initial public npm release.** The read-only synthetic demo has automated MCP and chat-client acceptance. Independent human onboarding and production use of real private data have not yet been verified.\n\n## First run\n\nAfter `npm install -g semantic-state-runtime`, run `ssrl-demo-init ./ssrl-example`.\nThe initializer refuses existing directories and creates:\n- `ssrl.config.json` with read-only synthetic Project Atlas data\n- `opencode.json` ready when you open the generated directory with OpenCode\n- `copilot.mcp-config.json` for merging the `ssrl` entry into your Copilot Global configuration (do not overwrite other servers)\n\nAsk your MCP client to call `context.compile` for `Project Atlas deadline`, expecting `2026-11-20`.\n\nThe MCP server itself needs no hosted account or API key; any chat model credentials belong to your own client. For your own data, read [the explicit configuration guide](docs/local-node-runtime-v1.md) before granting file or write permissions.\n\n[Source code](https://github.com/oaslananka/semantic-state-runtime) | [MIT License](LICENSE) | [Third-party notices](THIRD_PARTY_NOTICES.txt)\n");

    command(process.execPath, [join(destination, "dist/cli.js"), "--help"], destination);
    console.log((publishable ? "Unpublished public npm release candidate ready: " : "Private npm preview ready: ") + destination);
    console.log(publishable ? "Publish only from the matching GitHub Release via trusted GitHub Actions OIDC." : "Run npm pack from this directory; do not publish this preview.");
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
