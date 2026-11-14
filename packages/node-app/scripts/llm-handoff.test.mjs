import assert from "node:assert/strict";
import { test } from "node:test";
import { runLiveHandoff } from "./llm-handoff.mjs";

function fakeChat({ messages, requestedTool }) {
  const id = "mock-call-" + (requestedTool ?? "answer");
  let arg;
  if (requestedTool === "state_plan") {
    arg = { entityId: "entity://project/atlas" };
  } else if (requestedTool === "state_apply") {
    arg = {
      entityId: "entity://project/atlas",
      proposalDigest: JSON.parse(messages.findLast((m) => m.role === "tool").content).proposalDigest,
    };
  } else if (requestedTool === "context_compile") {
    arg = { task: "Project Atlas current deadline", budgetTokens: 180 };
  }
  return Promise.resolve(requestedTool ? {
    tool_calls: [{ type: "function", id, function: {
      name: requestedTool, arguments: JSON.stringify(arg),
    } }],
  } : { content: "The verified Project Atlas deadline is 2026-11-20." });
}

test("two-model orchestration uses real policy-scoped MCP tools without network", async () => {
  const log = [];
  const result = await runLiveHandoff({ chat: fakeChat, log: (line) => log.push(line) });
  assert.equal(result.modelCalls, 4);
  assert.equal(result.mcpCalls, 3);
  assert.equal(log.length, 3);
  assert.match(log[2], /^PASS:/);
});

test("a model cannot execute an unexpected MCP tool name", async () => {
  await assert.rejects(
    runLiveHandoff({
      chat: ({ requestedTool }) => fakeChat({ messages: [], requestedTool }).then((message) => ({
        ...message, tool_calls: message.tool_calls.map((call) => ({
          ...call, function: { ...call.function, name: "unsafe_tool" },
        })),
      })),
      log: () => {},
    }),
    /Expected values to be strictly equal/,
  );
});

test("a model answer containing forbidden evidence fails the acceptance check", async () => {
  await assert.rejects(
    runLiveHandoff({
      chat: async (args) => args.requestedTool
        ? fakeChat(args)
        : { content: "The deadline is 2026-11-20 and PRIVATE-EVIDENCE" },
      log: () => {},
    }),
    /policy-denied value was exposed/,
  );
});
