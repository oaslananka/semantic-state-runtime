import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandoffFixture } from "./handoff-fixture.mjs";

const modelA = "nvidia/nemotron-3.5-bolt-e4b";
const modelB = "mistralai/mistral-large-4-1t-a52b";
const endpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
const forbidden = ["PRIVATE-EVIDENCE", "REPLICA-ONLY-SECRET", "Project.secret"];

function tool(name, description, properties, required) {
  return { type: "function", function: {
    name, description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  } };
}

const tools = {
  state_plan: tool("state_plan", "Plan authorized reconciliation, without changing data.",
    { entityId: { type: "string", description: "Exact configured entity ID" } }, ["entityId"]),
  state_apply: tool("state_apply", "Apply the approved plan digest to the writable replica.",
    { entityId: { type: "string" }, proposalDigest: { type: "string" } },
    ["entityId", "proposalDigest"]),
  context_compile: tool("context_compile", "Read authorized current project context.",
    { task: { type: "string" }, budgetTokens: { type: "integer" } }, ["task", "budgetTokens"]),
};

async function nvidiaChat({ model, messages, requestedTool }) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY is required for the live demo.");
  const body = {
    model, messages, stream: false, temperature: 0, max_tokens: 256,
    parallel_tool_calls: false,
    ...(requestedTool ? {
      tools: [tools[requestedTool]],
      tool_choice: { type: "function", function: { name: requestedTool } },
    } : {}),
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  });
  if (!response.ok) throw new Error("NVIDIA model request failed (HTTP " + response.status + ").");
  const value = await response.json();
  const message = value.choices?.[0]?.message;
  if (!message) throw new Error("Missing model response.");
  return message;
}

function requestedCall(message, name) {
  const calls = message?.tool_calls;
  assert.equal(Array.isArray(calls) ? calls.length : 0, 1,
    "Expected exactly one model-generated tool call.");
  const call = calls[0];
  assert.equal(call.function?.name, name);
  assert.equal(typeof call.id, "string");
  const args = JSON.parse(call.function.arguments);
  assert.ok(args && typeof args === "object" && !Array.isArray(args));
  return { call, args };
}

function allowArguments(args, keys) {
  assert.deepEqual(Object.keys(args).sort((a, b) => a.localeCompare(b)),
    keys.slice().sort((a, b) => a.localeCompare(b)),
    "Unexpected or missing tool arguments.");
}

function ensureNoPrivateData(value) {
  const serialized = JSON.stringify(value);
  for (const text of forbidden) {
    assert.equal(serialized.includes(text), false, "A policy-denied value was exposed.");
  }
}

function messageWithToolResult(call, result) {
  return [
    { role: "assistant", content: null, tool_calls: [call] },
    { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) },
  ];
}

export async function runLiveHandoff({
  chat = nvidiaChat,
  log = console.log,
} = {}) {
  // No model sees the source notes or any unfiltered MCP tool response.
  const fixture = await createHandoffFixture();
  const { entityId, replica, connect, close } = fixture;
  let modelCalls = 0;
  try {
    const agentA = await connect("llm-agent-a");
    try {
      const conversationA = [
        { role: "system", content: "You are Agent A. Use only the supplied tool. Never invent entity IDs or proposal digests." },
        { role: "user", content: "Call state_plan for exact entityId " + entityId + " to reconcile the stale Project Atlas deadline." },
      ];
      const planMessage = await chat({ model: modelA, messages: conversationA, requestedTool: "state_plan" });
      modelCalls += 1;
      const planCall = requestedCall(planMessage, "state_plan");
      allowArguments(planCall.args, ["entityId"]);
      assert.equal(planCall.args.entityId, entityId);
      const proposal = await agentA.callTool({ name: "state.plan", arguments: planCall.args });
      assert.notEqual(proposal.isError, true);
      ensureNoPrivateData(proposal);
      const digest = proposal.structuredContent?.proposalDigest;
      assert.match(digest, /^sha256:[a-f0-9]{64}$/);

      const applyMessages = [
        ...conversationA,
        ...messageWithToolResult(planCall.call, { proposalDigest: digest }),
        { role: "user", content: "Call state_apply to apply the plan for entityId " + entityId +
          " using the exact returned proposalDigest. Do not change any other fields." },
      ];
      const applyMessage = await chat({ model: modelA, messages: applyMessages, requestedTool: "state_apply" });
      modelCalls += 1;
      const applyCall = requestedCall(applyMessage, "state_apply");
      allowArguments(applyCall.args, ["entityId", "proposalDigest"]);
      assert.equal(applyCall.args.entityId, entityId);
      assert.equal(applyCall.args.proposalDigest, digest);
      const applied = await agentA.callTool({ name: "state.apply", arguments: applyCall.args });
      assert.notEqual(applied.isError, true);
      ensureNoPrivateData(applied);
      const updated = await readFile(join(replica, "project.md"), "utf8");
      assert.match(updated, /deadline: "2026-11-20"/);
      assert.match(updated, /unrelated: keep/);
      assert.match(updated, /REPLICA-ONLY-SECRET/);
      log("Agent A (" + modelA + "): generated plan/apply MCP tool calls; reconciled deadline.");
    } finally {
      await agentA.close();
    }

    // The next MCP process is independent and reads persisted local state.
    const agentB = await connect("llm-agent-b");
    try {
      const conversationB = [
        { role: "system", content: "You are Agent B. Read the available authorized MCP context before answering; never guess." },
        { role: "user", content: "Call context_compile to read the current deadline for Project Atlas. Use budgetTokens 180." },
      ];
      const readMessage = await chat({ model: modelB, messages: conversationB, requestedTool: "context_compile" });
      modelCalls += 1;
      const readCall = requestedCall(readMessage, "context_compile");
      allowArguments(readCall.args, ["task", "budgetTokens"]);
      assert.match(readCall.args.task, /Atlas/i);
      assert.match(readCall.args.task, /deadline/i);
      assert.ok(Number.isInteger(readCall.args.budgetTokens) &&
        readCall.args.budgetTokens > 0 && readCall.args.budgetTokens <= 200);
      const compiled = await agentB.callTool({
        name: "context.compile", arguments: readCall.args,
      });
      assert.notEqual(compiled.isError, true);
      assert.equal(compiled.structuredContent?.resolution?.status, "resolved");
      assert.equal(compiled.structuredContent?.resolution?.entityId, entityId);
      ensureNoPrivateData(compiled);
      assert.match(JSON.stringify(compiled), /2026-11-20/);

      // Export only the actually returned policy-authorized deadline record.
      const records = compiled.structuredContent?.records;
      assert.ok(Array.isArray(records));
      const allowed = records.filter((record) =>
        record.entityId === entityId && record.id === "capsule-state:" + entityId + ":Project.deadline");
      assert.equal(allowed.length, 1);
      const extracted = allowed[0].text.match(/(20\d{2}-\d{2}-\d{2})/);
      assert.ok(extracted);
      assert.equal(extracted[1], "2026-11-20");
      const safeReadback = {
        entityId, currentDeadline: extracted[1],
        authorizedRecord: allowed[0].text, source: "policy-scoped MCP context.compile",
      };
      ensureNoPrivateData(safeReadback);
      const answer = await chat({
        model: modelB,
        messages: [
          ...conversationB,
          ...messageWithToolResult(readCall.call, safeReadback),
          { role: "user", content: "State the verified Project Atlas deadline in one short sentence." },
        ],
      });
      modelCalls += 1;
      assert.equal(typeof answer.content, "string");
      assert.match(answer.content, /2026-11-20/);
      ensureNoPrivateData(answer.content);
      log("Agent B (" + modelB + "): called context.compile and correctly answered: " +
        answer.content.trim().slice(0, 180));
    } finally {
      await agentB.close();
    }
    assert.equal(modelCalls, 4);
    log("PASS: 2 different live LLMs, 4 inference calls, 3 authorized MCP tool calls, persisted handoff.");
    return { modelA, modelB, modelCalls, mcpCalls: 3 };
  } finally {
    await close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await runLiveHandoff();
  } catch (error) {
    console.error("Live handoff failed: " + (error instanceof Error ? error.message : "unknown error"));
    process.exitCode = 1;
  }
}
