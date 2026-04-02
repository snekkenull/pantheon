import assert from "node:assert/strict";
import test from "node:test";

import { requestRemoteExchangeCompletion } from "../scripts/generate-exchange-demo.js";

test("requestRemoteExchangeCompletion falls back to the next model after an HTTP failure", async () => {
  const seenModels: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    seenModels.push(body.model);

    if (body.model === "broken-model") {
      return new Response("upstream failure", { status: 503 });
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "🫀 ⚖️\n🫀 ⚖️\n🌊 🕸️\n🌊 🕸️",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const completion = await requestRemoteExchangeCompletion({
    prompt: "exchange",
    leftAgentId: "left",
    rightAgentId: "right",
    endpoint: "https://example.test/v1/chat/completions",
    token: "secret",
    models: ["broken-model", "working-model"],
    fetchImpl,
  });

  assert.deepEqual(seenModels, ["broken-model", "working-model"]);
  assert.equal(completion.model, "working-model");
  assert.equal(completion.turns.length, 4);
  assert.equal(completion.turns[0]?.speakerId, "left");
  assert.equal(completion.turns[1]?.speakerId, "right");
});

test("requestRemoteExchangeCompletion falls back when a model returns non-emoji text", async () => {
  const seenModels: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    seenModels.push(body.model);

    if (body.model === "wordy-model") {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "hello\nthis is not emoji\nstill words\nfail",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "🫀 ⚖️\n🌊 🕸️\n🧭 🪞\n🎯 🧭",
            },
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  const completion = await requestRemoteExchangeCompletion({
    prompt: "exchange",
    leftAgentId: "left",
    rightAgentId: "right",
    endpoint: "https://example.test/v1/chat/completions",
    token: "secret",
    models: ["wordy-model", "emoji-model"],
    fetchImpl,
  });

  assert.deepEqual(seenModels, ["wordy-model", "emoji-model"]);
  assert.equal(completion.model, "emoji-model");
  assert.deepEqual(
    completion.turns.map((turn) => turn.sequences),
    [["🫀", "⚖️"], ["🌊", "🕸️"], ["🧭", "🪞"], ["🎯", "🧭"]],
  );
});
