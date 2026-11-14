import { spawnSync } from "node:child_process";
import { lstat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = fileURLToPath(new URL("../", import.meta.url));

function insideRepository(target) {
  const rel = relative(repository, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
}

export function command(executable, args, cwd = repository) {
  const result = spawnSync(executable, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Command exited with status " + (result.status ?? result.signal));
  }
}

export function pnpm(args) {
  const runner = process.env.npm_execpath;
  if (!runner || !/pnpm/i.test(runner)) {
    throw new Error("Use the pinned package manager: pnpm <script>.");
  }
  const js = /\.(?:c?js|mjs)$/i.test(runner);
  command(js ? process.execPath : runner, js ? [runner, ...args] : args);
}

export async function requireNewDestination(path, outsideMessage) {
  const destination = resolve(path);
  if (insideRepository(destination)) throw new Error(outsideMessage);
  try {
    await lstat(destination);
  } catch (error) {
    if (error.code === "ENOENT") return destination;
    throw error;
  }
  throw new Error("Destination already exists; refusing to overwrite: " + destination);
}
