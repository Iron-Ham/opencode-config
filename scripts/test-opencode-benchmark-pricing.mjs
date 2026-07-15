#!/usr/bin/env bun

import assert from "node:assert/strict";

import { recomputedRequestCost } from "./opencode-benchmark-runtime.mjs";

function finish({
  cost = 0,
  input = 0,
  output = 0,
  reasoning = 0,
  cacheRead = 0,
  cacheWrite = 0,
} = {}) {
  return {
    type: "step_finish",
    part: {
      cost,
      tokens: {
        input,
        output,
        reasoning,
        cache: {
          read: cacheRead,
          write: cacheWrite,
        },
      },
    },
  };
}

const gpt55WithoutCacheWrite = recomputedRequestCost(
  finish({ input: 100, output: 20, reasoning: 5, cacheRead: 50 }),
  "openai/gpt-5.5",
);
assert.equal(Number.isFinite(gpt55WithoutCacheWrite), true);
assert.equal(gpt55WithoutCacheWrite, 0.001275);

assert.equal(
  recomputedRequestCost(
    finish({ cost: 0.42, input: 100, cacheWrite: 10 }),
    "openai/gpt-5.5",
  ),
  0.42,
);

assert.equal(
  recomputedRequestCost(
    finish({ cost: 1.23, input: 100, cacheWrite: 10 }),
    "openai/gpt-5.5",
  ),
  1.23,
);

assert.equal(
  recomputedRequestCost(
    finish({ input: 273000, output: 1000 }),
    "openai/gpt-5.6-terra",
  ),
  1.3875,
);

assert.equal(
  recomputedRequestCost(finish({ cost: 0.75 }), "example/unknown"),
  0.75,
);

assert.equal(
  recomputedRequestCost(
    finish({ input: 100, output: 20, reasoning: 5, cacheRead: 50 }),
    "fireworks-ai/accounts/fireworks/models/glm-5p2",
  ),
  0.000257,
);
assert.equal(
  recomputedRequestCost(
    finish({ input: 100, output: 20, reasoning: 5, cacheRead: 50 }),
    "fireworks-ai/accounts/fireworks/routers/glm-5p2-fast",
  ),
  0.0003855,
);
assert.equal(
  recomputedRequestCost(
    finish({ input: 100, output: 20, reasoning: 5, cacheRead: 50 }),
    "baseten/zai-org/GLM-5.2",
  ),
  0.000263,
);
assert.equal(
  recomputedRequestCost(
    finish({ input: 100, output: 20, reasoning: 5, cacheRead: 50 }),
    "fireworks-ai/accounts/fireworks/models/kimi-k2p7-code",
  ),
  0.0002045,
);
assert.equal(
  recomputedRequestCost(
    finish({ input: 100, output: 20, reasoning: 5, cacheRead: 50 }),
    "baseten/moonshotai/Kimi-K2.7-Code",
  ),
  0.000203,
);
assert.equal(
  recomputedRequestCost(
    finish({ input: 300000 }),
    "fireworks-ai/accounts/fireworks/models/glm-5p2",
  ),
  0.42,
);
assert.equal(
  recomputedRequestCost(
    finish({ cost: 0.45, cacheWrite: 1 }),
    "fireworks-ai/accounts/fireworks/models/glm-5p2",
  ),
  0.45,
);

console.log("PASS OpenCode benchmark price normalization");
