#!/usr/bin/env bun

import assert from "node:assert/strict";

import { summarizeCostTree } from "../opencode/tui/total-cost.ts";

const sessions = [
  { id: "root", cost: 1.25 },
  { id: "worker-a", parentID: "root", cost: 0.5 },
  { id: "worker-b", parentID: "root", cost: 0.75 },
  { id: "nested", parentID: "worker-a", cost: 0.25 },
  { id: "unrelated", cost: 100 },
];

assert.deepEqual(summarizeCostTree("root", sessions), {
  rootCost: 1.25,
  subagentCost: 1.5,
  subagentCount: 3,
  totalCost: 2.75,
});

assert.deepEqual(
  summarizeCostTree("root", [
    { id: "root", cost: 1 },
    { id: "child", parentID: "root", cost: 2 },
    { id: "cycle", parentID: "child", cost: 3 },
    { id: "child", parentID: "cycle", cost: 99 },
  ]),
  {
    rootCost: 1,
    subagentCost: 5,
    subagentCount: 2,
    totalCost: 6,
  },
);

assert.deepEqual(summarizeCostTree("missing", sessions), {
  rootCost: 0,
  subagentCost: 0,
  subagentCount: 0,
  totalCost: 0,
});

console.log("OK     OpenCode total-cost aggregation");
