#!/usr/bin/env node
import { basename, dirname, join, resolve } from "node:path";
import { lstat } from "node:fs/promises";
import { connectProject, refreshProject } from "./project-connect.js";

function usage() {
  console.log("Usage: ssrl-connect <existing-folder|github-url|owner/repo> [--out new-folder] [--github owner/repo] [--local-only]");
  console.log("       ssrl-connect --refresh <connected-workspace>");
  console.log("Connect one project read-only. Create an isolated workspace without modifying the source.");
  console.log("GitHub is read via HTTPS on demand. Anonymous public reads or existing GH_TOKEN/GITHUB_TOKEN are supported.");
}

async function main(args: readonly string[]): Promise<void> {
  if (args.length === 1 && ["--help","-h"].includes(args[0]!)) { usage(); return; }
  if (args.length===2 && args[0]==="--refresh") {
    await refreshProject(join(resolve(args[1]!),"project.json"),{force:true});
    console.log("SSRL project sources refreshed. The original project was not changed.");
    return;
  }
  if (args.length===0 || args[0]!.startsWith("-")) { usage(); process.exitCode=2; return; }
  let target: string|undefined;
  let github: string|undefined;
  let localOnly=false;
  for(let i=0;i<args.length;i++) {
    const arg=args[i]!;
    if (i===0) continue;
    if(arg==="--out" && i+1<args.length) {target=args[++i];continue;}
    if(arg==="--github" && i+1<args.length) {github=args[++i];continue;}
    if(arg==="--local-only") {localOnly=true;continue;}
    throw new Error("Unknown or incomplete option: "+arg+". Use --help.");
  }
  if(localOnly&&github)throw new Error("Choose either --github or --local-only.");
  const label=args[0]!.replace(/\/$/, "").split(/[\\/]/).at(-1)!.replace(/\.git$/i,"");
  const safe=label.replace(/[^A-Za-z0-9_-]/g,"-").slice(0,60)||"project";
  const chosen = resolve(args[0]!);
  const isFolder = await lstat(chosen).then(info=>info.isDirectory()).catch(error=>{
    if ((error as NodeJS.ErrnoException).code==="ENOENT") return false;
    throw error;
  });
  // A user running "ssrl-connect ." from inside their repo must not need
  // to choose an output directory or write generated files into that repo.
  const destination=resolve(target??(isFolder
    ?join(dirname(chosen),"ssrl-"+basename(chosen))
    :"ssrl-"+safe));
  const result=await connectProject(args[0]!,{
    destination,...(github===undefined?{}:{github}),autoDetectGithub:!localOnly,
  });
  console.log("SSRL connected: "+(result.githubRepo??basename(result.localRoot!)));
  console.log("Workspace: "+result.workspace);
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

try { await main(process.argv.slice(2)); }
catch(error) {
  console.error("SSRL connection failed: "+(error instanceof Error?error.message:"unknown error"));
  process.exitCode=1;
}
