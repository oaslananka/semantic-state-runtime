import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, symlink, lstat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectProject, refreshProject } from "../src/project-connect.js";
import { createLocalRuntimeApp, loadLocalAppConfig } from "../src/index.js";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ssrl-project-accept-"));
  roots.push(root);
  return { root, project: join(root, "sample-project"), workspace: join(root, "connected") };
}
function githubResponse(issues: Array<{number:number;title:string;state?:string}>, pulls: Array<{number:number;title:string}>=[]) {
  const urls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/repos/acme/sample-project")) {
      return Response.json({full_name:"acme/sample-project",description:"A real public project",html_url:"https://github.com/acme/sample-project"});
    }
    if (url.includes("/issues?")) {
      return Response.json(issues.map((v) => ({ ...v, state:v.state??"open", html_url:"https://github.com/acme/sample-project/issues/"+v.number })));
    }
    if (url.includes("/pulls?")) {
      return Response.json(pulls.map((v) => ({...v,state:"open",html_url:"https://github.com/acme/sample-project/pull/"+v.number })));
    }
    throw Error("Unplanned GitHub request: " + url);
  };
  return {fetchImpl, urls};
}
describe("one-command project connection", () => {
  it("takes a GitHub URL, writes a read-only standalone workspace and client definitions", async () => {
    const { workspace } = await fixture();
    const {fetchImpl, urls} = githubResponse([{number:141,title:"Finish first-run acceptance"}]);
    const result = await connectProject("https://github.com/acme/sample-project", {destination:workspace, fetchImpl});
    expect(result.githubRepo).toBe("acme/sample-project");
    expect(urls).toHaveLength(3);
    const config=JSON.parse(await readFile(join(workspace,"ssrl.config.json"),"utf8"));
    const connection=JSON.parse(await readFile(join(workspace,"project.json"),"utf8"));
    expect(connection.projectId).toMatch(/^[a-f0-9]{32}$/);
    expect(config.entities[0].entityId).toBe("entity://project/"+connection.projectId);
    expect(config.principal.scopes).toEqual(["state:read","context:read"]);
    expect(config.policy.operations).toEqual({plan:false,apply:false});
    expect(config.policy.fields.every((p:{write:boolean})=>p.write===false)).toBe(true);
    expect(config.providers.map((p:{id:string})=>p.id)).toEqual(["github"]);
    const opencode=JSON.parse(await readFile(join(workspace,"opencode.json"),"utf8"));
    expect(opencode.mcp.servers.ssrl.command[2]).toBe("--project");
    expect(opencode.mcp.servers.ssrl.command[3]).toBe(join(workspace,"project.json"));
    expect(opencode.permissions[0].effect).toBe("deny");
    const copilot=JSON.parse(await readFile(join(workspace,"copilot.mcp-config.json"),"utf8"));
    expect(copilot.mcpServers.ssrl.command).toBe(process.execPath);
    expect(copilot.mcpServers.ssrl.args).toEqual(opencode.mcp.servers.ssrl.command.slice(1));
    const antigravity=JSON.parse(await readFile(join(workspace,".agents/mcp_config.json"),"utf8"));
    expect(antigravity.mcpServers.ssrl).toEqual(copilot.mcpServers.ssrl);
    const remote=await readFile(join(workspace,"sources/github/project.md"),"utf8");
    expect(remote).toContain("#141");
    expect(remote).not.toContain("PRIVATELY_SENSITIVE");
    expect(await lstat(join(workspace,"project.json"))).toBeDefined();
    await expect(connectProject("https://github.com/acme/sample-project", {destination:workspace,fetchImpl})).rejects.toThrow(/exists|overwrite/i);
  });

  it("rediscovers newly created Markdown while remote issue metadata changes",async()=>{
    const {project, workspace}=await fixture();
    await mkdir(join(project,"docs"),{recursive:true});
    await writeFile(join(project,"README.md"),"# Real Project\nWe use TypeScript to validate authority.\n");
    await writeFile(join(project,".env"),"PRIVATE-EVIDENCE=never-read");
    await writeFile(join(project,"docs/architecture.md"),"# Architecture\nThe original design is read-only.\n");
    const remote=githubResponse([{number:1,title:"First issue"}]);
    await connectProject(project,{destination:workspace,github:"acme/sample-project",fetchImpl:remote.fetchImpl});
    const first=await readFile(join(workspace,"sources/local/project.md"),"utf8");
    expect(first).toContain("README.md");
    expect(first).toContain("docs/architecture.md");
    expect(first).not.toContain("PRIVATE-EVIDENCE");
    await writeFile(join(project,"docs/next.md"),"# Next step\nShip a working user experience.\n");
    await writeFile(join(project,"README.md"),"# Real Project\nUpdated decisions and a new next step.\n");
    const newRemote=githubResponse([{number:1,title:"First issue"},{number:2,title:"New issue"}],[{number:3,title:"Improve docs"}]);
    await refreshProject(join(workspace,"project.json"),{fetchImpl:newRemote.fetchImpl,force:true});
    const later=await readFile(join(workspace,"sources/local/project.md"),"utf8");
    const github=await readFile(join(workspace,"sources/github/project.md"),"utf8");
    expect(later).toContain("docs/next.md");
    expect(first).toContain("snapshot_open_issue_ids: [1]");
    expect(later).toContain("snapshot_open_issue_ids: [1]");
    expect(later).not.toContain("snapshot_open_issue_ids: [1,2]");
    expect(later).toContain("Updated decisions");
    expect(github).toContain("#2");
    expect(github).toContain("#3");
    expect(github).not.toContain("PRIVATE-EVIDENCE");
    const config=JSON.parse(await readFile(join(workspace,"ssrl.config.json"),"utf8"));
    expect(config.entities).toHaveLength(1);
    expect(config.entities[0].authority).toContainEqual({property:"Project.openIssueIds",provider:"github"});
  });

  it("fails closed when GitHub cannot refresh and does not overwrite a last known source",async()=>{
    const {workspace}=await fixture();
    const {fetchImpl}=githubResponse([{number:21,title:"Observed"}]);
    await connectProject("acme/sample-project",{destination:workspace,fetchImpl});
    const before=await readFile(join(workspace,"sources/github/project.md"),"utf8");
    const failed:typeof fetch=async()=>new Response("not available",{status:503});
    await expect(refreshProject(join(workspace,"project.json"),{fetchImpl:failed,force:true})).rejects.toThrow(/GitHub|HTTP|refresh/i);
    expect(await readFile(join(workspace,"sources/github/project.md"),"utf8")).toBe(before);
  });

  it("skips symlinks and hidden documents and never writes to the selected repository",async()=>{
    const {project,workspace,root}=await fixture();
    await mkdir(join(project,"docs"),{recursive:true});
    await writeFile(join(project,"README.md"),"# Public quickstart\n");
    await writeFile(join(root,"secret.md"),"PRIVATE-EVIDENCE");
    try { await symlink(join(root,"secret.md"),join(project,"docs/secret.md")); }
    catch(e) { if((e as NodeJS.ErrnoException).code!=="EPERM") throw e; }
    await writeFile(join(project,"docs/.internal.md"),"PRIVATE-EVIDENCE");
    await connectProject(project,{destination:workspace,autoDetectGithub:false});
    const src=await readFile(join(workspace,"sources/local/project.md"),"utf8");
    expect(src).toContain("README.md");
    expect(src).not.toContain("PRIVATE-EVIDENCE");
    expect(src).not.toContain("secret.md");
    expect(await lstat(join(project,"README.md"))).toBeDefined();
    await expect(readFile(join(project,".ssrl","ssrl.config.json"))).rejects.toThrow();
  });
  it("rechecks live GitHub issues and local docs in the same MCP client session",async()=>{
    const {project,workspace}=await fixture();
    await mkdir(project);
    await writeFile(join(project,"README.md"),"# Initial plan\n");
    const initial=githubResponse([{number:1,title:"Before"}]);
    await connectProject(project,{destination:workspace,github:"acme/sample-project",fetchImpl:initial.fetchImpl});
    const {config}=await loadLocalAppConfig(join(workspace,"ssrl.config.json"));
    let api=initial.fetchImpl;
    const app=await createLocalRuntimeApp(config,{
      sourceRefresh:()=>refreshProject(join(workspace,"project.json"),{fetchImpl:api,force:true}),
    });
    const server=app.createMcpServer();
    const client=new Client({name:"live-project-smoke",version:"1.0.0"});
    const [c,s]=InMemoryTransport.createLinkedPair();
    await server.connect(s);
    await client.connect(c);
    try {
      const first=await client.callTool({name:"context.compile",arguments:{task:"acme/sample-project open GitHub issues",budgetTokens:1200}});
      expect(first.isError).not.toBe(true);
      expect(JSON.stringify(first.structuredContent)).toContain("#1");
      api=githubResponse([{number:2,title:"After refresh"}]).fetchImpl;
      await writeFile(join(project,"README.md"),"# Updated project decision\n");
      const second=await client.callTool({name:"context.compile",arguments:{task:"acme/sample-project open GitHub issues",budgetTokens:1200}});
      expect(second.isError).not.toBe(true);
      expect(JSON.stringify(second.structuredContent)).toContain("#2");
      expect(JSON.stringify(second.structuredContent)).not.toContain("#1 Before");
      expect(JSON.stringify(second.structuredContent)).toContain("Updated project decision");
      api=async()=>new Response("unavailable",{status:503});
      const failed=await client.callTool({name:"context.compile",arguments:{task:"acme/sample-project open GitHub issues",budgetTokens:1200}});
      expect(failed.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
      app.close();
    }
  });

  it("connects large real-world docs folders without silently claiming full coverage",async()=>{
    const {project,workspace}=await fixture();
    await mkdir(join(project,"docs"),{recursive:true});
    await writeFile(join(project,"README.md"),"# Public project\n");
    await writeFile(join(project,"CHANGELOG.md"),"Z".repeat(70*1024));
    for(let i=0;i<26;i++){
      const file="docs/doc-"+String(i).padStart(2,"0")+".md";
      await writeFile(join(project,file),"# Note "+i+"\n");
    }
    await connectProject(project,{destination:workspace,autoDetectGithub:false});
    const value=await readFile(join(workspace,"sources/local/project.md"),"utf8");
    expect(value).toContain("README.md");
    expect(value).toContain("SKIPPED");
    expect(value).toContain("LIMIT");
    expect(value).not.toContain("Z".repeat(300));
  });

  it("rejects a GitHub issue whose source URL belongs to another repository", async()=>{
    const {workspace}=await fixture();
    const {fetchImpl}=githubResponse([{number:12,title:"Not our issue"}]);
    const forged:typeof fetch=async (input,init)=>{
      const url=String(input);
      const response=await fetchImpl(input,init);
      if(url.includes("/issues?")){
        return Response.json([{number:12,title:"Not our issue",
          html_url:"https://github.com/another/repo/issues/12"}]);
      }
      return response;
    };
    await expect(connectProject("acme/sample-project",{destination:workspace,fetchImpl:forged})).rejects.toThrow(/GitHub|identity|item/i);
    await expect(readFile(join(workspace,"ssrl.config.json"))).rejects.toThrow();
  });

  it("rejects an output folder hidden inside the source through a directory alias",async()=>{
    const {root,project}=await fixture();
    await mkdir(project);
    await writeFile(join(project,"README.md"),"# Truth\n");
    const alias=join(root,"linked-project");
    try{await symlink(project,alias,process.platform==="win32"?"junction":"dir");}
    catch(error){if((error as NodeJS.ErrnoException).code==="EPERM")return;throw error;}
    await expect(connectProject(project,{destination:join(alias,"ssrl"),autoDetectGithub:false}))
      .rejects.toThrow(/outside the selected project/);
    await expect(readFile(join(project,"ssrl","project.json"))).rejects.toThrow();
  });

  it("does not follow a symlinked docs root outside the chosen project", async () => {
    const { project, workspace, root } = await fixture();
    await mkdir(project);
    await writeFile(join(project, "README.md"), "# Real selected project\\n".replaceAll("\\n", "\n"));
    const external = join(root, "private-documents");
    await mkdir(external);
    await writeFile(join(external, "leaked.md"), "PRIVATE-EVIDENCE=outside-project");
    try {
      await symlink(external, join(project, "docs"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await connectProject(project, { destination: workspace, autoDetectGithub: false });
    const source = await readFile(join(workspace, "sources/local/project.md"), "utf8");
    expect(source).toContain("Real selected project");
    expect(source).not.toContain("PRIVATE-EVIDENCE");
    expect(source).not.toContain("leaked.md");
    expect(source).toContain("[SKIPPED: docs root is a link or not a directory]");
  });

});
