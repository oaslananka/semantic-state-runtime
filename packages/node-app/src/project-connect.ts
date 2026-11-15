import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const PROJECT_SCHEMA = "ssrl-connected-project-v1";
const REFRESH_MS = 60_000;
const GITHUB_BASE = "https://api.github.com";
const DOC_LIMIT = 20;
const FILE_BYTES = 64 * 1024;
const RESPONSE_BYTES = 512 * 1024;

interface ProjectSettings {
  schemaVersion: typeof PROJECT_SCHEMA;
  projectId: string;
  localRoot?: string;
  githubRepo?: string;
  refreshIntervalMs: number;
}
export interface ConnectOptions {
  destination: string;
  github?: string;
  autoDetectGithub?: boolean;
  fetchImpl?: typeof fetch;
}
export interface RefreshOptions {
  fetchImpl?: typeof fetch;
  force?: boolean;
  now?: () => number;
}
export interface ConnectionResult {
  workspace: string;
  localRoot?: string;
  githubRepo?: string;
}
function scrub(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 175);
}

export function parseGitHubRepository(raw: string): string | undefined {
  let text=raw.trim();
  if (text.startsWith("https://github.com/")) {
    const url = new URL(text);
    if (url.username || url.password || url.search || url.hash || url.port
      || url.hostname !== "github.com") throw new Error("GitHub URL must be plain https://github.com/owner/repo.");
    text=url.pathname.replace(/^\/|\/$/g,"").replace(/\.git$/i,"");
  } else if (text.includes("://") || text.startsWith("git@")) {
    throw new Error("Only GitHub HTTPS URLs or owner/repo identifiers are supported.");
  }
  const parts=/^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/(\w[\w.-]{0,99})$/.exec(text);
  if (!parts || parts[2]==="." || parts[2]==="..") return undefined;
  return parts[1]+"/"+parts[2];
}
async function optionalLocalDir(path:string):Promise<boolean> {
  try {
    const info=await lstat(path);
    if (info.isSymbolicLink()) throw new Error("Selected directory cannot be a symbolic link.");
    return info.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==="ENOENT") return false;
    throw error;
  }
}
async function githubFromGitRemote(folder:string):Promise<string|undefined> {
  try {
    const result=await execFileAsync("git",["-C",folder,"remote","get-url","origin"],{
      timeout:2000,maxBuffer:2048,windowsHide:true,
    });
    const text=result.stdout.trim();
    if (text.startsWith("git@github.com:")) return parseGitHubRepository(text.slice(15).replace(/\.git$/i,""));
    if (text.startsWith("https://github.com/")) return parseGitHubRepository(text);
  } catch { /* Local folders do not require git or remote access. */ }
  return undefined;
}
async function sourcesFor(input:string, options:ConnectOptions):Promise<{localRoot?:string;githubRepo?:string}> {
  if (await optionalLocalDir(resolve(input))) {
    const localRoot=await realpath(resolve(input));
    let githubRepo: string | undefined;
    if (options.github !== undefined) githubRepo = parseGitHubRepository(options.github);
    else if (options.autoDetectGithub !== false) githubRepo = await githubFromGitRemote(localRoot);
    if (options.github!==undefined && !githubRepo) throw new Error("Invalid GitHub owner/repo.");
    return {localRoot,...(githubRepo?{githubRepo}:{})};
  }
  const githubRepo=parseGitHubRepository(input);
  if (!githubRepo || options.github!==undefined) throw new Error("Choose an existing folder or a GitHub owner/repo URL.");
  return {githubRepo};
}
function manifest(id:string,fields:readonly {canonical:string;external:string}[]) {
  return {
    schemaVersion:"0.1",id,displayName:id==="github"?"Current GitHub metadata":"Selected local project docs",
    capabilities:{read:true,write:false,observe:true,subscribe:false,revisions:"opaque",idempotency:"none"},
    entities:[{canonicalType:"Project",externalType:"markdown",fields:fields.map(f=>({...f,access:["read"]}))}],
  };
}
const githubFields=[
  {canonical:"Project.repository",external:"name"},
  {canonical:"Project.openIssueIds",external:"open_issue_ids"},
  {canonical:"Project.openIssues",external:"open_issues"},
  {canonical:"Project.openPulls",external:"open_pulls"},
  {canonical:"Project.githubDescription",external:"description"},
];
async function localReadmeTitle(root: string | undefined): Promise<string | undefined> {
  if (!root || !(await selectRootMarkdown(root)).includes("README.md")) return undefined;
  // Reuse the existing bounded, no-symlink document reader.
  const excerpt = await markdownExcerpt(root, "README.md");
  const heading = /^#\s+(.{1,120})\s*$/m.exec(excerpt)?.[1]
    ?? /<h1\b[^>]*>([^<>]{1,120})<\/h1>/i.exec(excerpt)?.[1];
  const title = heading ? scrub(heading) : "";
  return title.length >= 2 && title.length <= 120 ? title : undefined;
}
function projectConfig(settings:ProjectSettings,label:string,readmeTitle?:string) {
  const local=!!settings.localRoot,github=!!settings.githubRepo;
  const localFields=[
    {canonical:"Project.repository",external:"name"},
    {canonical:"Project.documents",external:"documents"},
    ...(github?[{canonical:"Project.openIssueIds",external:"snapshot_open_issue_ids"}]:[]),
  ];
  const providers=[
    ...(local?[{id:"local",root:"./sources/local",manifest:manifest("local",localFields)}]:[]),
    ...(github?[{id:"github",root:"./sources/github",manifest:manifest("github",githubFields)}]:[]),
  ];
  const entityId="entity://project/"+settings.projectId;
  const aliases=[...new Set([label,settings.githubRepo,settings.githubRepo?.split("/").at(-1),readmeTitle]
    .filter((v):v is string=>typeof v==="string"&&v.length>0))];
  const authority=[
    ...(local?[{property:"Project.documents",provider:"local"}]:[]),
    ...(github?githubFields.map(f=>({property:f.canonical,provider:"github"}))
      :[{property:"Project.repository",provider:"local"}]),
  ];
  const fields=[...new Set(providers.flatMap(p=>p.manifest.entities[0]!.fields.map(f=>f.canonical)))];
  return {
    schemaVersion:"1",journalPath:"./state/runtime.sqlite",
    context:{
      semanticStatePath:"./state/semantic.sqlite",ingestionStatePath:"./state/ingestion.sqlite",
      artifactStoreRoot:"./state/artifacts",
      sources:providers.map(p=>({provider:p.id,externalType:"markdown"})),
      sourceVerificationMaxAgeMs:0,maxBudgetTokens:1600,
    },
    principal:{subject:"user:connected-project",scopes:["state:read","context:read"]},
    providers,
    entities:[{
      entityId,aliases,
      bindings:providers.map(p=>({provider:p.id,externalId:"project.md",canonicalType:"Project"})),
      authority,
    }],
    policy:{
      operations:{plan:false,apply:false},
      fields:fields.map(property=>({entityId,property,read:true,write:false})),
    },
  };
}
function sourceMarkdown(fields:Record<string,string|readonly number[]>,label:string):string {
  return "---\n"+Object.entries(fields).map(([k,v])=>k+": "+JSON.stringify(v)).join("\n")
    +"\n---\n# "+scrub(label)+"\n";
}
async function replaceAtomic(path:string,text:string):Promise<void> {
  let prev:string|undefined;
  try { prev=await readFile(path,"utf8"); } catch(e) {
    if ((e as NodeJS.ErrnoException).code!=="ENOENT") throw e;
  }
  if (prev===text) return;
  const tmp=join(dirname(path),"."+basename(path)+"."+process.pid+"."+randomBytes(6).toString("hex")+".tmp");
  try {
    await writeFile(tmp,text,{encoding:"utf8",mode:0o600,flag:"wx"});
    await rename(tmp,path);
  } finally { await rm(tmp,{force:true}); }
}
async function selectRootMarkdown(root: string): Promise<string[]> {
  const names = ["README.md", "ROADMAP.md", "CHANGELOG.md", "TODO.md"];
  const found = await Promise.all(names.map(async name => {
    try {
      const info = await lstat(join(root, name));
      return info.isFile() && !info.isSymbolicLink() ? name : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }));
  return found.filter((value): value is string => value !== undefined);
}

async function selectNestedMarkdown(
  root: string,
  initial: readonly string[],
): Promise<{ selected: string[]; omitted: boolean; skippedLinkedRoot: boolean }> {
  const selected = [...initial];
  let omitted = false;

  // The root docs folder itself can be a symlink/junction to outside the
  // project. Checking only its children does not prevent that data leak.
  const docsRoot = join(root, "docs");
  try {
    const docsInfo = await lstat(docsRoot);
    if (docsInfo.isSymbolicLink() || !docsInfo.isDirectory()) {
      return { selected, omitted: false, skippedLinkedRoot: true };
    }
    const canonical = await realpath(docsRoot);
    const fromProject = relative(root, canonical);
    if (fromProject.startsWith("..") || isAbsolute(fromProject)) {
      return { selected, omitted: false, skippedLinkedRoot: true };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { selected, omitted, skippedLinkedRoot: false };
    throw error;
  }

  async function scan(folder: string, prefix: string, depth: number): Promise<void> {
    if (depth > 2) return;
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    // A serial Promise chain keeps source order deterministic while bounding I/O.
    const ordered = entries.toSorted((a, b) => a.name.localeCompare(b.name, "en"));
    await ordered.reduce((previous, entry) => previous.then(async () => {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) return;
      if (entry.isDirectory()) {
        await scan(join(folder, entry.name), prefix + entry.name + "/", depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        selected.push(prefix + entry.name);
      }
      if (selected.length > DOC_LIMIT) {
        selected.pop();
        omitted = true;
      }
    }), Promise.resolve());
  }
  await scan(join(root, "docs"), "docs/", 0);
  return { selected, omitted, skippedLinkedRoot: false };
}

async function markdownExcerpt(root: string, relativePath: string): Promise<string> {
  const path = join(root, ...relativePath.split("/"));
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("Document changed during scan: " + relativePath);
  }
  if (info.size > FILE_BYTES) return "FILE " + relativePath + " [SKIPPED: 64 KiB LIMIT]";
  const data = await readFile(path, "utf8");
  if (Buffer.byteLength(data) > FILE_BYTES) {
    throw new Error("Document changed during read: " + relativePath);
  }
  const excerpt = data.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").slice(0, 1100);
  return "FILE " + relativePath + "\n" + excerpt
    + (data.length > 1100 ? "\n[EXCERPT TRUNCATED]" : "");
}

async function collectLocalDocuments(root: string): Promise<string> {
  const topLevel = await selectRootMarkdown(root);
  const { selected, omitted, skippedLinkedRoot } = await selectNestedMarkdown(root, topLevel);
  if (selected.length === 0) {
    return "No selected README, ROADMAP, CHANGELOG, TODO or docs Markdown found.";
  }
  // At most DOC_LIMIT files are read in parallel; order is deterministic.
  const sections = await Promise.all(selected.map(item => markdownExcerpt(root, item)));
  const aggregate = sections.join("\n\n---\n\n");
  return aggregate.slice(0, 11_000)
    + (aggregate.length > 11_000 ? "\n[DOCUMENT INVENTORY TRUNCATED]" : "")
    + (omitted ? "\n[SKIPPED: 20 DOCUMENT LIMIT; other docs may exist]" : "")
    + (skippedLinkedRoot ? "\n[SKIPPED: docs root is a link or not a directory]" : "");
}

function githubHttpError(response: Response): Error {
  if(response.status!==403 && response.status!==429) {
    return new Error("GitHub refresh failed (HTTP "+response.status+").");
  }
  const limited=response.status===429 || response.headers.get("x-ratelimit-remaining")==="0";
  const reset=Number(response.headers.get("x-ratelimit-reset"));
  const retryAfter=limited && Number.isSafeInteger(reset) && reset>0 && reset<8.64e12
    ? " Retry after "+new Date(reset*1000).toISOString()+"."
    : "";
  return new Error((limited?"GitHub API rate limit reached":"GitHub API access denied")
    +" (HTTP "+response.status+")."+retryAfter
    +" Retry later or use an existing GH_TOKEN/GITHUB_TOKEN in your shell."
    +" No stale GitHub issue or PR data was treated as current.");
}
async function githubGet(path:string,fetchImpl:typeof fetch):Promise<unknown> {
  const headers:Record<string,string>={
    accept:"application/vnd.github+json","x-github-api-version":"2022-11-28",
    "user-agent":"semantic-state-runtime-local",
  };
  const token=process.env.GH_TOKEN??process.env.GITHUB_TOKEN;
  if(token)headers.authorization="Bearer "+token;
  let response:Response;
  try {
    response=await fetchImpl(GITHUB_BASE+path,{
      method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(9000),
    });
  }catch{throw new Error("GitHub refresh unavailable. Old metadata was not served as fresh.");}
  if(!response.ok)throw githubHttpError(response);
  if(Number(response.headers.get("content-length")??0)>RESPONSE_BYTES)
    throw new Error("GitHub response exceeded 512 KiB.");
  const body=response.body?.getReader();
  if(!body)throw new Error("GitHub returned no content.");
  let bytes=0;
  const chunks:Uint8Array[]=[];
  try {
    for(;;){
      const entry=await body.read();
      if(entry.done)break;
      bytes+=entry.value.byteLength;
      if(bytes>RESPONSE_BYTES)throw new Error("GitHub response exceeded 512 KiB.");
      chunks.push(entry.value);
    }
  }finally{body.releaseLock();}
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;}
  catch{throw new Error("GitHub returned invalid metadata.");}
}
interface GitHubItem {number:number;title:string;html_url:string;pull_request?:unknown}
interface GitHubRepo {full_name:string;description:string|null}
function validItems(raw:unknown,repository:string):GitHubItem[] {
  if(!Array.isArray(raw)||raw.length>20)throw new Error("GitHub metadata is invalid or over the 20-item bound.");
  return raw.map((entry:unknown)=>{
    if(!entry||typeof entry!=="object")throw new Error("GitHub item is invalid.");
    const item=entry as Partial<GitHubItem>;
    const source = typeof item.html_url==="string"
      ? /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)$/.exec(item.html_url)
      : null;
    if(typeof item.number!=="number"||!Number.isSafeInteger(item.number)||item.number<1||
      typeof item.title!=="string"||
      source?.[1]?.toLowerCase()!==repository.toLowerCase()||
      Number(source?.[3])!==item.number){
      throw new Error("GitHub item has invalid identity.");
    }
    return item as GitHubItem;
  });
}
async function fetchGitHub(repo:string,fetchImpl:typeof fetch) {
  const stem="/repos/"+repo;
  const [rawRepo,rawIssues,rawPulls]=await Promise.all([
    githubGet(stem,fetchImpl),
    githubGet(stem+"/issues?state=open&per_page=20&sort=updated&direction=desc",fetchImpl),
    githubGet(stem+"/pulls?state=open&per_page=20&sort=updated&direction=desc",fetchImpl),
  ]);
  if(!rawRepo||typeof rawRepo!=="object"||
      (rawRepo as GitHubRepo).full_name?.toLowerCase()!==repo.toLowerCase())
    throw new Error("GitHub returned mismatched repository identity.");
  return {
    repo:rawRepo as GitHubRepo,
    issues:validItems(rawIssues,repo).filter(x=>x.pull_request===undefined),
    pulls:validItems(rawPulls,repo),
  };
}
function titles(items:readonly GitHubItem[],category:string):string {
  return (items.length===0?"No open "+category+" in the returned window.":items.map(x=>
    "#"+x.number+" "+scrub(x.title)+" "+x.html_url).join("\n"))
    +(items.length===20?"\n[Only first 20 API results; more may exist]":"");
}
async function readSettings(file:string):Promise<ProjectSettings> {
  let obj:Partial<ProjectSettings>;
  try {obj=JSON.parse(await readFile(file,"utf8")) as Partial<ProjectSettings>;}
  catch{throw new Error("Invalid or missing SSRL connected-project configuration.");}
  if(obj.schemaVersion!==PROJECT_SCHEMA||
     typeof obj.projectId!=="string" || !/^[a-f0-9]{32}$/.test(obj.projectId) ||
     (!obj.githubRepo&&!obj.localRoot)||
     (obj.githubRepo!==undefined&&parseGitHubRepository(obj.githubRepo)!==obj.githubRepo)||
     (obj.localRoot!==undefined&&(!isAbsolute(obj.localRoot)||typeof obj.localRoot!=="string"))||
     obj.refreshIntervalMs!==REFRESH_MS)throw new Error("Invalid SSRL connected-project configuration.");
  return obj as ProjectSettings;
}

type FetchedGitHub = Awaited<ReturnType<typeof fetchGitHub>>;

async function lastGitHubFetch(path: string): Promise<number> {
  try {
    const metadata = JSON.parse(await readFile(path, "utf8")) as { githubFetchedAt?: unknown };
    return typeof metadata.githubFetchedAt === "number" && Number.isFinite(metadata.githubFetchedAt)
      ? metadata.githubFetchedAt : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return 0;
    throw error;
  }
}

function shouldRefreshGitHub(
  settings: ProjectSettings,
  last: number,
  now: number,
  force: boolean,
): boolean {
  if (!settings.githubRepo) return false;
  // Anonymous GitHub has a 60-request/hour budget. Three API reads per
  // refresh make a five-minute minimum more sustainable than one minute.
  const rateWindow = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)
    ? settings.refreshIntervalMs : 5 * 60_000;
  return force || now - last >= rateWindow || last > now;
}

async function originalIssueSnapshot(
  workspace: string,
  remote: FetchedGitHub | undefined,
): Promise<number[]> {
  try {
    const previous = await readFile(join(workspace, "sources/local/project.md"), "utf8");
    const match = /^snapshot_open_issue_ids:\s*(\[[^\n]*\])/m.exec(previous);
    if (!match) throw new Error("The offline issue snapshot is missing; refusing to infer history.");
    const value = JSON.parse(match[1]!) as unknown;
    if (!Array.isArray(value) || value.some(item => !Number.isSafeInteger(item) || item < 1)) {
      throw new Error("Invalid historical GitHub issue snapshot.");
    }
    return value as number[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || remote === undefined) throw error;
    // The first snapshot is historical evidence, not mutable live GitHub state.
    return remote.issues.map(item => item.number);
  }
}

async function saveLocalSource(
  workspace: string,
  settings: ProjectSettings,
  docs: string | undefined,
  remote: FetchedGitHub | undefined,
): Promise<void> {
  if (docs === undefined) return;
  const label = settings.githubRepo ?? basename(settings.localRoot!);
  const fields: Record<string, string | readonly number[]> = { name: label, documents: docs };
  if (settings.githubRepo) {
    fields.snapshot_open_issue_ids = await originalIssueSnapshot(workspace, remote);
  }
  await replaceAtomic(join(workspace, "sources/local/project.md"),
    sourceMarkdown(fields, "Local project document excerpts"));
}

async function saveGitHubSource(
  workspace: string,
  remote: FetchedGitHub,
  now: number,
): Promise<void> {
  const fields: Record<string, string | readonly number[]> = {
    name: remote.repo.full_name,
    description: scrub(remote.repo.description ?? "No description"),
    open_issue_ids: remote.issues.map(item => item.number),
    open_issues: titles(remote.issues, "issues"),
    open_pulls: titles(remote.pulls, "pull requests"),
  };
  await replaceAtomic(join(workspace, "sources/github/project.md"),
    sourceMarkdown(fields, "Current GitHub issue and PR metadata"));
  await replaceAtomic(join(workspace, "refresh.json"),
    JSON.stringify({ githubFetchedAt: now }, null, 2) + "\n");
}

export async function refreshProject(file: string, options: RefreshOptions = {}): Promise<void> {
  const workspace = dirname(resolve(file));
  const settings = await readSettings(resolve(file));
  const now = (options.now ?? Date.now)();
  const last = await lastGitHubFetch(join(workspace, "refresh.json"));
  const remote = shouldRefreshGitHub(settings, last, now, options.force === true)
    ? await fetchGitHub(settings.githubRepo!, options.fetchImpl ?? fetch)
    : undefined;
  // Fail due GitHub reads before committing any newly selected local data.
  const docs = settings.localRoot ? await collectLocalDocuments(settings.localRoot) : undefined;
  await saveLocalSource(workspace, settings, docs, remote);
  if (remote) await saveGitHubSource(workspace, remote, now);
}

export async function connectProject(input:string,options:ConnectOptions):Promise<ConnectionResult> {
  const sources=await sourcesFor(input,options);
  const workspace=resolve(options.destination);
  try {await lstat(workspace);throw new Error("Output directory already exists; refusing to overwrite.");}
  catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}
  if(sources.localRoot){
    // Resolve the output's parent to catch symlink/junction aliases that
    // would otherwise smuggle generated files into the selected repository.
    const canonicalParent=await realpath(dirname(workspace));
    const canonicalDestination=join(canonicalParent,basename(workspace));
    const rel=relative(sources.localRoot,canonicalDestination);
    if(rel===""||(!rel.startsWith("..")&&!isAbsolute(rel)))
      throw new Error("Output workspace must be outside the selected project.");
  }
  const settings:ProjectSettings={
    schemaVersion:PROJECT_SCHEMA,projectId:randomBytes(16).toString("hex"),...sources,refreshIntervalMs:REFRESH_MS,
  };
  await mkdir(workspace,{mode:0o700});
  try{
    await mkdir(join(workspace,"sources"),{mode:0o700});
    if(sources.localRoot)await mkdir(join(workspace,"sources/local"),{mode:0o700});
    if(sources.githubRepo)await mkdir(join(workspace,"sources/github"),{mode:0o700});
    const meta=join(workspace,"project.json");
    await writeFile(meta,JSON.stringify(settings,null,2)+"\n",{mode:0o600});
    await refreshProject(meta,{...(options.fetchImpl===undefined?{}:{fetchImpl:options.fetchImpl}),force:true});
    const readmeTitle=await localReadmeTitle(sources.localRoot);
    const name=sources.githubRepo??basename(sources.localRoot!);
    await writeFile(join(workspace,"ssrl.config.json"),
      JSON.stringify(projectConfig(settings,name,readmeTitle),null,2)+"\n",{mode:0o600});
    const command=[process.execPath,fileURLToPath(new URL("./cli.js",import.meta.url)),"--project",meta];
    await writeFile(join(workspace,"opencode.json"),JSON.stringify({
      $schema:"https://opencode.ai/config.json",
      mcp:{servers:{ssrl:{type:"local",command,cwd:workspace}}},
      permissions:[
        {action:"*",resource:"*",effect:"deny"},
        {action:"ssrl_context_compile",resource:"*",effect:"allow"},
      ],
    },null,2)+"\n",{mode:0o600});
    await writeFile(join(workspace,"copilot.mcp-config.json"),JSON.stringify({
      mcpServers:{ssrl:{command:command[0],args:command.slice(1)}},
    },null,2)+"\n",{mode:0o600});
    await mkdir(join(workspace,".agents"),{mode:0o700});
    // Antigravity's documented workspace-local MCP config uses this exact
    // mcpServers shape. Keep global Antigravity settings untouched.
    await writeFile(join(workspace,".agents/mcp_config.json"),JSON.stringify({
      mcpServers:{ssrl:{command:command[0],args:command.slice(1)}},
    },null,2)+"\n",{mode:0o600});
    await writeFile(join(workspace,"START-HERE.md"),
      "# Your SSRL project\n\nYour connected GitHub/local project is read-only. No source repo files are modified.\n\n"+
      "Open this workspace in OpenCode or Antigravity; opencode.json and .agents/mcp_config.json are ready. Ask your AI to call SSRL context.compile for the latest open issues and project docs of "+(readmeTitle??name)+".\n\n"+
      "For VS Code Copilot merge the ssrl entry from copilot.mcp-config.json into your existing global MCP config. Do not overwrite other servers.\n\n"+
      "GitHub issues are refreshed on demand: within five minutes anonymously or one minute with an existing GitHub token. Use ssrl-connect --refresh <workspace> for an immediate check. No background daemon or paid API. "+
      "Selected local files: README, ROADMAP, CHANGELOG, TODO, plus up to 20 docs/**/*.md files. Each file is capped at 64 KiB. "+
      "GitHub issue titles are untrusted source data, not instructions. A failed remote refresh returns an error instead of silently using stale data.\n");
    return {workspace,...sources};
  }catch(e){await rm(workspace,{recursive:true,force:true});throw e;}
}
