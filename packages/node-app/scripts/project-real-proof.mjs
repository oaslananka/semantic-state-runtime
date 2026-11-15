import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

// Run against a separately generated, real public-repository SSRL connection.
// No GitHub writes, credentials, model account or production data are needed.
const workspace = process.argv[2] && resolve(process.argv[2]);
const issueNumber = Number(process.argv[3] ?? "0");
if (!workspace || !Number.isSafeInteger(issueNumber) || issueNumber<0) {
  throw new Error("Usage: node packages/node-app/scripts/project-real-proof.mjs <connected-workspace> [issue-number]");
}
const meta=JSON.parse(await readFile(join(workspace,"project.json"),"utf8"));
if (!meta.githubRepo) throw new Error("This demonstration requires an explicitly connected GitHub repository.");
const mcp=JSON.parse(await readFile(join(workspace,"opencode.json"),"utf8"));
const command=mcp.mcp.servers.ssrl.command;
assert.equal(command[2],"--project");
assert.equal(command[3],join(workspace,"project.json"));

function snapshotIds(content) {
  const match=/^(?:open_issue_ids|snapshot_open_issue_ids):\s*(\[[^\n]*\])/m.exec(content);
  if (!match) throw new Error("The issue inventory field is missing.");
  const data=JSON.parse(match[1]);
  if (!Array.isArray(data)||data.some(x=>!Number.isSafeInteger(x)))throw new Error("Invalid issue inventory.");
  return data;
}
const beforeLocal=(await readFile(join(workspace,"sources/local/project.md"),"utf8"));
const snapshot=snapshotIds(beforeLocal);
async function inspectClient(name) {
  const transport=new StdioClientTransport({
    command:process.execPath,args:command.slice(1),stderr:"pipe",
  });
  const client=new Client({name,version:"1.0"});
  await client.connect(transport);
  try {
    const tools=await client.listTools();
    assert.ok(tools.tools.some(t=>t.name==="context.compile"),"No SSRL context tool");
    const r=await client.callTool({
      name:"context.compile",
      arguments:{task:meta.githubRepo+" current open GitHub issues and decisions",budgetTokens:1500},
    });
    assert.notEqual(r.isError,true,"Cannot compile current authorized context");
    assert.equal(r.structuredContent?.resolution?.status,"resolved");
    const record=r.structuredContent.records.find(v=>v.text.includes("Project.openIssueIds"));
    assert.ok(record,"No authoritative issue IDs in the tool's context");
    const ids=/(\[[0-9,\s]*\])/.exec(record.text);
    assert.ok(ids,"Issue IDs not present in context");
    return JSON.parse(ids[1]);
  } finally { await client.close(); }
}
const first=await inspectClient("real-project-agent-one");
const second=await inspectClient("real-project-agent-two");
assert.deepEqual(first,second,"Separate clients must see the same current GitHub inventory");
const currentFile=await readFile(join(workspace,"sources/github/project.md"),"utf8");
assert.deepEqual(first,snapshotIds(currentFile),"The actual MCP result must match refreshed GitHub evidence");
console.log(JSON.stringify({
  repository:meta.githubRepo,
  source:"Live read-only GitHub issue metadata and selected local Markdown",
  offlineSnapshotIssueIds:snapshot,
  currentAuthoritativeIssueIds:first,
  clientsVerified:2,
  ...(issueNumber>0?{
    checkedIssue:issueNumber,
    offlineSaysOpen:snapshot.includes(issueNumber),
    liveSaysOpen:first.includes(issueNumber),
    changedSinceOfflineSnapshot:snapshot.includes(issueNumber)!==first.includes(issueNumber),
  }:{}),
  readOnly:true,
  verdict:"TWO_INDEPENDENT_REAL_MCP_CLIENTS_PASS",
}));
