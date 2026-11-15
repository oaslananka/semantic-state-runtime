import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const cli=process.env.SSRL_TEST_CLI_PATH;
const workspace=process.env.SSRL_TEST_CONNECTED_WORKSPACE;
const project=process.env.SSRL_TEST_CONNECTED_SOURCE;
if(!cli||!workspace||!project)throw new Error("Installed project smoke needs CLI, workspace and source.");
const config=JSON.parse(await readFile(join(workspace,"ssrl.config.json"),"utf8"));
assert.deepEqual(config.principal.scopes,["state:read","context:read"]);
const installedPackage = JSON.parse(await readFile(join(dirname(resolve(cli)), "..", "package.json"), "utf8"));
assert.equal(typeof installedPackage.version, "string");
assert.deepEqual(config.policy.operations,{plan:false,apply:false});
assert.ok(config.policy.fields.every(f=>f.write===false));

async function connect(name) {
  const client=new Client({name,version:"1.0.0"});
  const transport=new StdioClientTransport({
    command:process.execPath,args:[resolve(cli),"--project",join(workspace,"project.json")],stderr:"pipe",
  });
  await client.connect(transport);
  assert.equal(client.getServerVersion()?.version, installedPackage.version,
    "The advertised MCP server version must match the installed npm package.");
  return client;
}
async function compile(client) {
  const result=await client.callTool({
    name:"context.compile",
    arguments:{task:"selected-project README and project decisions",budgetTokens:1200},
  });
  assert.notEqual(result.isError,true,JSON.stringify(result));
  return JSON.stringify(result.structuredContent);
}
let c=await connect("first-real-mcp-client");
try {
  const before=await compile(c);
  assert.match(before,/INITIAL_PROJECT_DECISION/);
  await mkdir(join(project,"docs"),{recursive:true});
  await writeFile(join(project,"README.md"),"# Project\nUPDATED_PROJECT_DECISION\n");
  await writeFile(join(project,"docs/next.md"),"# Next\nNEW_DOCUMENT_DISCOVERED\n");
  const after=await compile(c);
  assert.match(after,/UPDATED_PROJECT_DECISION/);
  assert.match(after,/NEW_DOCUMENT_DISCOVERED/);
  assert.doesNotMatch(after,/INITIAL_PROJECT_DECISION/);
  const unsafe=await c.callTool({name:"state.apply",arguments:{
    entityId:config.entities[0].entityId,proposalDigest:"sha256:"+"0".repeat(64),
  }});
  assert.equal(unsafe.isError,true,"Source writes must fail closed");
}finally{await c.close();}
c=await connect("independent-second-client");
try {
  const afterRestart=await compile(c);
  assert.match(afterRestart,/UPDATED_PROJECT_DECISION/);
  assert.match(afterRestart,/NEW_DOCUMENT_DISCOVERED/);
}finally{await c.close();}
console.log("Published project connection PASS: dynamic local docs, denied writes and two independent MCP clients.");
