#!/usr/bin/env bun

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SUPPORTED_PROTOCOL = "controlled-swift-direct-review-revision-v1";
const DIRECT_STATUSES = new Set(["completed", "failed", "incomplete", "timeout"]);
const REVIEWED_STATUSES = new Set([
  "advisor_failed",
  "completed",
  "implementation_session_unavailable",
  "revision_failed",
]);
const COMPLETE_COST = "complete_for_observed_requests";
const LOWER_BOUND_COST = "unknown_total_lower_bound";
const COST_COMPLETENESS_VALUES = new Set([COMPLETE_COST, LOWER_BOUND_COST]);
const CONFIDENCE_LIMITATIONS = [
  "Repeated trials on one fixture share the same task, contract, and hidden oracle, so repetitions are not independent production tasks.",
  "Nominal Wilson intervals summarize binomial quality-floor acceptance only; shared fixtures weaken the independence assumption, and the intervals are not a non-inferiority test or multiple-comparison adjustment.",
  "A small number of fixtures can miss important iOS failure modes even when the trial count is larger.",
  "Costs use the runner's normalized list-price accounting and may differ from invoiced cost, discounts, or future pricing.",
];
const PARTIAL_RUN_LIMITATIONS = [
  "Partial-run mode includes only the longest consecutive repetition prefix containing every selected candidate exactly once; completed results outside that prefix are excluded.",
  "Missing scheduled trials are reported as stopped early and are not treated as quality failures.",
  "A balanced candidate block can still be short of the full Latin-square cycle, so model order effects may remain unbalanced.",
];

function parseArguments(argv) {
  const inputDirs = [];
  let outputFile;
  let selfTest = false;
  let partialRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--self-test") {
      selfTest = true;
      continue;
    }
    if (argument === "--partial-run") {
      partialRun = true;
      continue;
    }
    const [flag, inlineValue] = argument.split(/=(.*)/s, 2);
    if (flag !== "--input-dir" && flag !== "--output-file") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (flag === "--input-dir") {
      inputDirs.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
    } else {
      if (outputFile) throw new Error("--output-file may be supplied only once");
      outputFile = value;
    }
  }

  if (selfTest) {
    if (inputDirs.length > 0 || outputFile || partialRun) {
      throw new Error("--self-test cannot be combined with input or output arguments");
    }
    return { selfTest };
  }
  if (inputDirs.length === 0) throw new Error("Supply at least one --input-dir");
  if (!outputFile) throw new Error("Missing --output-file");
  return { inputDirs, outputFile, partialRun, selfTest };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read valid JSON from ${filePath}: ${error.message}`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireBenchmarkId(value, label) {
  const benchmarkId = requireString(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(benchmarkId)) {
    throw new Error(`${label} must use lowercase letters, digits, dots, dashes, or underscores`);
  }
  return benchmarkId;
}

function requireIdentifier(value, label) {
  const identifier = requireString(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/u.test(identifier)) {
    throw new Error(`${label} must be a lowercase identifier`);
  }
  return identifier;
}

function requireNonnegativeNumber(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite nonnegative number`);
  }
  return value;
}

function normalizeCostCompleteness(value, label) {
  const completeness = value ?? LOWER_BOUND_COST;
  if (!COST_COMPLETENESS_VALUES.has(completeness)) {
    throw new Error(`${label} must be ${[...COST_COMPLETENESS_VALUES].join(" or ")}`);
  }
  return completeness;
}

function safeModelConfiguration(value, label) {
  const config = requireObject(value, label);
  const model = requireString(config.model, `${label}.model`);
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(model)) {
    throw new Error(`${label}.model must be a provider/model identifier`);
  }
  const effort = requireIdentifier(config.effort, `${label}.effort`);
  const result = { model, effort };
  if (config.variant !== undefined) {
    result.variant = requireIdentifier(config.variant, `${label}.variant`);
  }
  return result;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeEvaluation(value, label, { required }) {
  if (value === null || value === undefined) {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  const evaluation = requireObject(value, label);
  const score = requireNonnegativeNumber(evaluation.score, `${label}.score`);
  if (score > 100) throw new Error(`${label}.score must not exceed 100`);
  if (typeof evaluation.quality_floor_passed !== "boolean") {
    throw new Error(`${label}.quality_floor_passed must be boolean`);
  }
  return { score, accepted: evaluation.quality_floor_passed };
}

function normalizeSourceChange(value, label) {
  if (value === undefined) return null;
  const provenance = requireObject(value, label);
  const directHash = provenance.direct_source_sha256;
  const reviewedHash = provenance.reviewed_source_sha256;
  const hashPattern = /^[a-f0-9]{64}$/u;
  if (directHash !== undefined && !hashPattern.test(directHash)) {
    throw new Error(`${label}.direct_source_sha256 must be a SHA-256 digest`);
  }
  if (reviewedHash !== undefined && !hashPattern.test(reviewedHash)) {
    throw new Error(`${label}.reviewed_source_sha256 must be a SHA-256 digest`);
  }
  if (reviewedHash !== undefined && directHash === undefined) {
    throw new Error(`${label} cannot have a reviewed source without a direct source`);
  }
  if (directHash === undefined || reviewedHash === undefined) return null;
  return directHash !== reviewedHash;
}

function normalizeRoute(value, label, { evaluationRequired, statuses }) {
  const route = requireObject(value, label);
  const status = requireString(route.status, `${label}.status`);
  if (!statuses.has(status)) throw new Error(`${label}.status is unsupported: ${status}`);
  const totals = requireObject(route.totals, `${label}.totals`);
  return {
    status,
    evaluation: normalizeEvaluation(route.evaluation, `${label}.evaluation`, {
      required: evaluationRequired,
    }),
    cost: requireNonnegativeNumber(
      totals.recomputed_cost_usd,
      `${label}.totals.recomputed_cost_usd`,
    ),
    costCompleteness: normalizeCostCompleteness(
      totals.cost_completeness,
      `${label}.totals.cost_completeness`,
    ),
  };
}

function readPartialTrialResults(directory, runIndex) {
  const results = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !entry.name.startsWith("swift-")) continue;
    const resultPath = path.join(directory, entry.name, "result.json");
    const resultEntry = fs.lstatSync(resultPath, { throwIfNoEntry: false });
    if (!resultEntry) continue;
    if (!resultEntry.isFile() || resultEntry.isSymbolicLink()) {
      throw new Error(`input ${runIndex} contains an unsafe completed result artifact`);
    }
    results.push(readJson(resultPath));
  }
  return results;
}

function validateSchedule({
  trial,
  metadata,
  candidate,
  repetition,
  label,
  required,
}) {
  if (trial.schedule === undefined && !required) return null;
  const schedule = requireObject(trial.schedule, `${label}.schedule`);
  if (schedule.seed !== metadata.seed) {
    throw new Error(`${label}.schedule.seed does not match metadata`);
  }
  if (
    !Array.isArray(schedule.selected_cohort) ||
    !sameValue(schedule.selected_cohort, metadata.selected)
  ) {
    throw new Error(`${label}.schedule.selected_cohort does not match metadata`);
  }
  if (schedule.block !== repetition) {
    throw new Error(`${label}.schedule.block does not match repetition`);
  }
  if (
    !Number.isInteger(schedule.order_position) ||
    schedule.order_position < 0 ||
    schedule.order_position >= metadata.selected.length
  ) {
    throw new Error(`${label}.schedule.order_position is outside the selected cohort`);
  }
  return { orderPosition: schedule.order_position };
}

function normalizeInputDirectory(inputDir, runIndex, { partialRun }) {
  const directory = path.resolve(inputDir);
  const metadata = requireObject(
    readJson(path.join(directory, "metadata.json")),
    `input ${runIndex} metadata`,
  );
  if (metadata.protocol !== SUPPORTED_PROTOCOL) {
    throw new Error(
      `input ${runIndex} protocol must be ${SUPPORTED_PROTOCOL}; got ${String(metadata.protocol)}`,
    );
  }
  const benchmarkId = requireBenchmarkId(
    metadata.benchmark_id,
    `input ${runIndex} benchmark_id`,
  );
  const repeat = metadata.repeat;
  if (!Number.isInteger(repeat) || repeat < 2) {
    throw new Error(`input ${runIndex} repeat must be an integer of at least 2`);
  }
  if (
    !Array.isArray(metadata.selected) ||
    metadata.selected.length === 0 ||
    metadata.selected.some(
      (item) => typeof item !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(item),
    ) ||
    new Set(metadata.selected).size !== metadata.selected.length
  ) {
    throw new Error(`input ${runIndex} selected must be a non-empty unique string array`);
  }
  if (partialRun && repeat % metadata.selected.length !== 0) {
    throw new Error(`input ${runIndex} metadata does not describe a full Latin-square schedule`);
  }
  const candidateEfforts = requireObject(
    metadata.candidate_efforts,
    `input ${runIndex} candidate_efforts`,
  );
  if (
    Object.keys(candidateEfforts).sort().join("\u0000") !==
      [...metadata.selected].sort().join("\u0000")
  ) {
    throw new Error(`input ${runIndex} candidate_efforts must match selected candidates`);
  }
  for (const candidate of metadata.selected) {
    requireIdentifier(
      candidateEfforts[candidate],
      `input ${runIndex} candidate_efforts.${candidate}`,
    );
  }
  const advisor = safeModelConfiguration(metadata.advisor, `input ${runIndex} advisor`);
  if (partialRun) requireString(metadata.seed, `input ${runIndex} seed`);
  const rawResults = partialRun
    ? readPartialTrialResults(directory, runIndex)
    : readJson(path.join(directory, "summary.json"));
  if (!Array.isArray(rawResults)) {
    throw new Error(`input ${runIndex} summary.json must contain an array`);
  }
  const expectedTrialCount = repeat * metadata.selected.length;
  if (!partialRun && rawResults.length !== expectedTrialCount) {
    throw new Error(
      `input ${runIndex} has ${rawResults.length} trials; expected ${expectedTrialCount}`,
    );
  }
  if (rawResults.length > expectedTrialCount) {
    throw new Error(`input ${runIndex} has more completed trials than its schedule permits`);
  }

  const seen = new Set();
  const discoveredTrials = rawResults.map((rawTrial, trialIndex) => {
    const trial = requireObject(rawTrial, `input ${runIndex} trial ${trialIndex + 1}`);
    if (trial.benchmark_id !== benchmarkId) {
      throw new Error(
        `input ${runIndex} trial ${trialIndex + 1} benchmark_id does not match metadata`,
      );
    }
    const candidate = requireIdentifier(
      trial.candidate,
      `input ${runIndex} trial ${trialIndex + 1} candidate`,
    );
    if (!metadata.selected.includes(candidate)) {
      throw new Error(`input ${runIndex} trial uses unselected candidate ${candidate}`);
    }
    const repetition = trial.repetition;
    if (!Number.isInteger(repetition) || repetition < 1 || repetition > repeat) {
      throw new Error(`input ${runIndex} ${candidate} repetition is outside 1...${repeat}`);
    }
    const trialKey = `${candidate}\u0000${repetition}`;
    if (seen.has(trialKey)) {
      throw new Error(`input ${runIndex} duplicates ${candidate} repetition ${repetition}`);
    }
    seen.add(trialKey);

    const candidateConfig = safeModelConfiguration(
      trial.model,
      `input ${runIndex} ${candidate} model`,
    );
    if (candidateConfig.effort !== candidateEfforts[candidate]) {
      throw new Error(`input ${runIndex} ${candidate} effort does not match metadata`);
    }
    const trialAdvisor = safeModelConfiguration(
      trial.advisor,
      `input ${runIndex} ${candidate} advisor`,
    );
    if (!sameValue(trialAdvisor, advisor)) {
      throw new Error(`input ${runIndex} ${candidate} advisor does not match metadata`);
    }
    const routes = requireObject(
      trial.routes,
      `input ${runIndex} ${candidate} routes`,
    );
    const direct = normalizeRoute(
      routes.direct,
      `input ${runIndex} ${candidate} direct route`,
      { evaluationRequired: true, statuses: DIRECT_STATUSES },
    );
    const reviewed = normalizeRoute(
      routes.reviewed,
      `input ${runIndex} ${candidate} reviewed route`,
      { evaluationRequired: false, statuses: REVIEWED_STATUSES },
    );
    if (reviewed.cost + 1e-9 < direct.cost) {
      throw new Error(`input ${runIndex} ${candidate} reviewed cost is below shared direct cost`);
    }
    if (
      direct.costCompleteness === LOWER_BOUND_COST &&
      reviewed.costCompleteness === COMPLETE_COST
    ) {
      throw new Error(
        `input ${runIndex} ${candidate} reviewed cost cannot be complete when its shared direct stage is incomplete`,
      );
    }
    const experimentTotals = requireObject(
      trial.experiment_totals,
      `input ${runIndex} ${candidate} experiment_totals`,
    );
    const experimentCost = requireNonnegativeNumber(
      experimentTotals.recomputed_cost_usd,
      `input ${runIndex} ${candidate} experiment cost`,
    );
    if (Math.abs(experimentCost - reviewed.cost) > 1e-6) {
      throw new Error(
        `input ${runIndex} ${candidate} experiment and reviewed-route costs diverge`,
      );
    }
    const experimentCostCompleteness = normalizeCostCompleteness(
      experimentTotals.cost_completeness,
      `input ${runIndex} ${candidate} experiment_totals.cost_completeness`,
    );
    if (experimentCostCompleteness !== reviewed.costCompleteness) {
      throw new Error(
        `input ${runIndex} ${candidate} experiment and reviewed cost completeness diverge`,
      );
    }
    const schedule = validateSchedule({
      trial,
      metadata,
      candidate,
      repetition,
      label: `input ${runIndex} ${candidate}`,
      required: partialRun,
    });
    const sourceChanged = normalizeSourceChange(
      trial.provenance,
      `input ${runIndex} ${candidate} provenance`,
    );

    return {
      benchmarkId,
      candidate,
      repetition,
      candidateConfig,
      advisor,
      direct,
      reviewed,
      experimentCost,
      experimentCostCompleteness,
      schedule,
      sourceChanged,
    };
  });

  let balancedPrefixRepetitions = repeat;
  if (partialRun) {
    balancedPrefixRepetitions = 0;
    for (let repetition = 1; repetition <= repeat; repetition += 1) {
      const block = discoveredTrials.filter((trial) => trial.repetition === repetition);
      const candidatesComplete = metadata.selected.every(
        (candidate) => seen.has(`${candidate}\u0000${repetition}`),
      );
      const positions = block.flatMap((trial) => trial.schedule
        ? [trial.schedule.orderPosition]
        : []);
      const orderComplete = positions.length === metadata.selected.length &&
        new Set(positions).size === metadata.selected.length;
      if (!candidatesComplete || !orderComplete) break;
      balancedPrefixRepetitions = repetition;
    }
  } else {
    for (const candidate of metadata.selected) {
      for (let repetition = 1; repetition <= repeat; repetition += 1) {
        if (!seen.has(`${candidate}\u0000${repetition}`)) {
          throw new Error(`input ${runIndex} is missing ${candidate} repetition ${repetition}`);
        }
      }
    }
  }

  const trials = discoveredTrials.filter(
    (trial) => trial.repetition <= balancedPrefixRepetitions,
  );
  const excludedCompletedTrialCount = discoveredTrials.length - trials.length;
  const missingPlannedTrialCount = expectedTrialCount - discoveredTrials.length;
  return {
    benchmarkId,
    repeat,
    selected: [...metadata.selected],
    advisor,
    trials,
    partialAccounting: {
      benchmark_id: benchmarkId,
      planned_trial_count: expectedTrialCount,
      discovered_completed_trial_count: discoveredTrials.length,
      included_trial_count: trials.length,
      balanced_prefix_repetition_count: balancedPrefixRepetitions,
      excluded_completed_trial_count: excludedCompletedTrialCount,
      stopped_early_missing_trial_count: missingPlannedTrialCount,
      excluded_or_missing_trial_count:
        excludedCompletedTrialCount + missingPlannedTrialCount,
      stopped_early: trials.length < expectedTrialCount,
      latin_square_cycle_complete:
        balancedPrefixRepetitions > 0 &&
        balancedPrefixRepetitions % metadata.selected.length === 0,
    },
  };
}

function rounded(value, digits = 6) {
  if (value === null) return null;
  return Number(value.toFixed(digits));
}

function divide(numerator, denominator) {
  return denominator === 0 ? null : rounded(numerator / denominator);
}

function scoreSummary(values) {
  if (values.length === 0) {
    return { evaluated: 0, mean: null, median: null, minimum: null, maximum: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    evaluated: sorted.length,
    mean: rounded(sorted.reduce((total, value) => total + value, 0) / sorted.length, 4),
    median: rounded(median, 4),
    minimum: sorted[0],
    maximum: sorted.at(-1),
  };
}

function wilsonInterval(successes, total) {
  if (total === 0) return null;
  const z = 1.959963984540054;
  const proportion = successes / total;
  const denominator = 1 + (z ** 2) / total;
  const center = (proportion + (z ** 2) / (2 * total)) / denominator;
  const halfWidth = (
    z * Math.sqrt(
      (proportion * (1 - proportion) + (z ** 2) / (4 * total)) / total,
    )
  ) / denominator;
  return [rounded(Math.max(0, center - halfWidth), 4), rounded(Math.min(1, center + halfWidth), 4)];
}

function aggregateCostCompleteness(values) {
  return values.every((value) => value === COMPLETE_COST)
    ? COMPLETE_COST
    : LOWER_BOUND_COST;
}

function costPerAccepted(total, accepted, costCompleteness) {
  if (accepted === 0) {
    return {
      usd: null,
      interpretation: "not_available_no_accepted_trials",
      cost_completeness: costCompleteness,
    };
  }
  return {
    usd: divide(total, accepted),
    interpretation: costCompleteness === COMPLETE_COST
      ? "complete_for_observed_requests"
      : "lower_bound",
    cost_completeness: costCompleteness,
  };
}

function routeSummary(trials, routeName) {
  const routes = trials.map((trial) => trial[routeName]);
  const accepted = routes.filter((route) => route.evaluation?.accepted === true).length;
  const evaluated = routes.filter((route) => route.evaluation !== null).length;
  const completed = routes.filter((route) => route.status === "completed").length;
  const costCompleteness = aggregateCostCompleteness(
    routes.map((route) => route.costCompleteness),
  );
  const statusCounts = Object.fromEntries(
    [...new Set(routes.map((route) => route.status))].sort().map((status) => [
      status,
      routes.filter((route) => route.status === status).length,
    ]),
  );
  return {
    attempted: routes.length,
    completed,
    evaluated,
    execution_failures: routes.length - completed,
    cost_completeness: costCompleteness,
    lower_bound_cost_trial_count: routes.filter(
      (route) => route.costCompleteness !== COMPLETE_COST,
    ).length,
    quality_floor: {
      accepted,
      rejected: routes.length - accepted,
      acceptance_rate: divide(accepted, routes.length),
      acceptance_rate_wilson_95: wilsonInterval(accepted, routes.length),
    },
    status_counts: statusCounts,
  };
}

function churnSubset(count, changed, comparable) {
  return {
    count,
    rate_among_source_changes: divide(count, changed),
    rate_among_comparable_trials: divide(count, comparable),
  };
}

function revisionSourceChurnSummary(trials) {
  const comparable = trials.filter((trial) => trial.sourceChanged !== null);
  const changed = comparable.filter((trial) => trial.sourceChanged);
  const changedWithUnchangedFloor = changed.filter((trial) =>
    trial.reviewed.evaluation !== null &&
    trial.direct.evaluation.accepted === trial.reviewed.evaluation.accepted
  ).length;
  const changedWithUnchangedScore = changed.filter((trial) =>
    trial.reviewed.evaluation !== null &&
    trial.direct.evaluation.score === trial.reviewed.evaluation.score
  ).length;
  const changedWithoutScoreImprovement = changed.filter((trial) =>
    trial.reviewed.evaluation !== null &&
    trial.reviewed.evaluation.score <= trial.direct.evaluation.score
  ).length;
  return {
    comparable_trials: comparable.length,
    unavailable_trials: trials.length - comparable.length,
    changed_trials: changed.length,
    unchanged_trials: comparable.length - changed.length,
    source_change_rate: divide(changed.length, comparable.length),
    changed_with_unchanged_quality_floor_outcome: churnSubset(
      changedWithUnchangedFloor,
      changed.length,
      comparable.length,
    ),
    changed_with_unchanged_score: churnSubset(
      changedWithUnchangedScore,
      changed.length,
      comparable.length,
    ),
    changed_without_score_improvement: churnSubset(
      changedWithoutScoreImprovement,
      changed.length,
      comparable.length,
    ),
  };
}

function confidenceClassification(trials) {
  const fixtureCount = new Set(trials.map((trial) => trial.benchmarkId)).size;
  if (fixtureCount < 5 || trials.length < 30) return "exploratory";
  if (fixtureCount < 10 || trials.length < 100) return "directional";
  return "expanded_not_definitive";
}

function summarizeTrials(trials) {
  const directAccepted = trials.filter((trial) => trial.direct.evaluation.accepted).length;
  const reviewedAccepted = trials.filter(
    (trial) => trial.reviewed.evaluation?.accepted === true,
  ).length;
  const rescues = trials.filter(
    (trial) => !trial.direct.evaluation.accepted && trial.reviewed.evaluation?.accepted === true,
  ).length;
  const harms = trials.filter(
    (trial) => trial.direct.evaluation.accepted && trial.reviewed.evaluation?.accepted !== true,
  ).length;
  const unchangedPass = trials.filter(
    (trial) => trial.direct.evaluation.accepted && trial.reviewed.evaluation?.accepted === true,
  ).length;
  const unchangedFail = trials.filter(
    (trial) => !trial.direct.evaluation.accepted && trial.reviewed.evaluation?.accepted !== true,
  ).length;
  const pairedScores = trials.filter((trial) => trial.reviewed.evaluation !== null);
  const experimentTotal = trials.reduce((total, trial) => total + trial.experimentCost, 0);
  const directTotal = trials.reduce((total, trial) => total + trial.direct.cost, 0);
  const reviewedTotal = trials.reduce((total, trial) => total + trial.reviewed.cost, 0);
  const incrementalTotal = reviewedTotal - directTotal;
  const experimentCostCompleteness = aggregateCostCompleteness(
    trials.map((trial) => trial.experimentCostCompleteness),
  );
  const directCostCompleteness = aggregateCostCompleteness(
    trials.map((trial) => trial.direct.costCompleteness),
  );
  const reviewedCostCompleteness = aggregateCostCompleteness(
    trials.map((trial) => trial.reviewed.costCompleteness),
  );
  const incrementalCostCompleteness =
    directCostCompleteness === COMPLETE_COST && reviewedCostCompleteness === COMPLETE_COST
      ? COMPLETE_COST
      : "unknown_difference_due_to_incomplete_stages";

  return {
    trial_count: trials.length,
    fixture_count: new Set(trials.map((trial) => trial.benchmarkId)).size,
    confidence: {
      classification: confidenceClassification(trials),
      limitations_apply: true,
    },
    routes: {
      direct: routeSummary(trials, "direct"),
      reviewed: routeSummary(trials, "reviewed"),
    },
    failures: {
      direct_execution: trials.filter((trial) => trial.direct.status !== "completed").length,
      reviewed_execution: trials.filter((trial) => trial.reviewed.status !== "completed").length,
      direct_quality_floor: trials.length - directAccepted,
      reviewed_quality_floor: trials.length - reviewedAccepted,
    },
    transitions: {
      rescues,
      harms,
      unchanged_pass: unchangedPass,
      unchanged_fail: unchangedFail,
      net_rescues: rescues - harms,
      net_rescue_rate: divide(rescues - harms, trials.length),
    },
    revision_source_churn: revisionSourceChurnSummary(trials),
    scores: {
      direct: scoreSummary(trials.map((trial) => trial.direct.evaluation.score)),
      reviewed: scoreSummary(
        trials.flatMap((trial) => trial.reviewed.evaluation
          ? [trial.reviewed.evaluation.score]
          : []),
      ),
      paired_reviewed_minus_direct: scoreSummary(
        pairedScores.map(
          (trial) => trial.reviewed.evaluation.score - trial.direct.evaluation.score,
        ),
      ),
    },
    costs_usd: {
      experiment: {
        total: rounded(experimentTotal),
        mean_per_trial: divide(experimentTotal, trials.length),
        cost_completeness: experimentCostCompleteness,
        lower_bound_cost_trial_count: trials.filter(
          (trial) => trial.experimentCostCompleteness !== COMPLETE_COST,
        ).length,
      },
      counterfactual_direct: {
        total: rounded(directTotal),
        mean_per_trial: divide(directTotal, trials.length),
        cost_completeness: directCostCompleteness,
        lower_bound_cost_trial_count: trials.filter(
          (trial) => trial.direct.costCompleteness !== COMPLETE_COST,
        ).length,
        cost_per_accepted: costPerAccepted(
          directTotal,
          directAccepted,
          directCostCompleteness,
        ),
      },
      counterfactual_reviewed: {
        total: rounded(reviewedTotal),
        mean_per_trial: divide(reviewedTotal, trials.length),
        cost_completeness: reviewedCostCompleteness,
        lower_bound_cost_trial_count: trials.filter(
          (trial) => trial.reviewed.costCompleteness !== COMPLETE_COST,
        ).length,
        cost_per_accepted: costPerAccepted(
          reviewedTotal,
          reviewedAccepted,
          reviewedCostCompleteness,
        ),
      },
      incremental_advisor_and_revision: {
        total: rounded(incrementalTotal),
        mean_per_trial: divide(incrementalTotal, trials.length),
        cost_completeness: incrementalCostCompleteness,
      },
    },
  };
}

function sortedObject(entries) {
  return Object.fromEntries([...entries].sort(([left], [right]) => left.localeCompare(right)));
}

function groupBy(trials, key) {
  const groups = new Map();
  for (const trial of trials) {
    const value = key(trial);
    const group = groups.get(value) ?? [];
    group.push(trial);
    groups.set(value, group);
  }
  return groups;
}

function summarizeInputDirs(inputDirs, { partialRun = false } = {}) {
  const resolved = inputDirs.map((directory) => fs.realpathSync(path.resolve(directory)));
  if (new Set(resolved).size !== resolved.length) {
    throw new Error("The same input directory was supplied more than once");
  }
  const runs = resolved.map((directory, index) => normalizeInputDirectory(
    directory,
    index + 1,
    { partialRun },
  )).sort((left, right) =>
    left.benchmarkId.localeCompare(right.benchmarkId) ||
    JSON.stringify(left.partialAccounting).localeCompare(JSON.stringify(right.partialAccounting))
  );
  if (
    partialRun &&
    runs.some((run) => !sameValue(run.selected, runs[0].selected))
  ) {
    throw new Error("All partial input directories must use the same selected candidate cohort");
  }
  const advisors = [...new Map(runs.map((run) => [
    JSON.stringify(run.advisor),
    run.advisor,
  ])).values()];
  if (advisors.length !== 1) {
    throw new Error("All paired input directories must use the same advisor configuration");
  }
  const trials = runs.flatMap((run) => run.trials).sort((left, right) =>
    left.candidate.localeCompare(right.candidate) ||
    left.benchmarkId.localeCompare(right.benchmarkId) ||
    left.repetition - right.repetition
  );
  if (trials.length === 0) {
    throw new Error("No complete balanced repetition prefix was available to aggregate");
  }
  const candidateConfigs = new Map();
  for (const trial of trials) {
    const existing = candidateConfigs.get(trial.candidate);
    if (existing && !sameValue(existing, trial.candidateConfig)) {
      throw new Error(`Candidate ${trial.candidate} has conflicting model metadata`);
    }
    candidateConfigs.set(trial.candidate, trial.candidateConfig);
  }
  const byCandidate = groupBy(trials, (trial) => trial.candidate);
  const byFixture = groupBy(trials, (trial) => trial.benchmarkId);
  const byCandidateFixture = groupBy(
    trials,
    (trial) => `${trial.candidate}\u0000${trial.benchmarkId}`,
  );

  return {
    schema_version: 1,
    protocol: SUPPORTED_PROTOCOL,
    input_run_count: runs.length,
    fixture_count: byFixture.size,
    trial_count: trials.length,
    model_metadata: {
      candidates: sortedObject(candidateConfigs.entries()),
      advisor: advisors[0],
    },
    partial_run: {
      enabled: partialRun,
      stopped_early: runs.some((run) => run.partialAccounting.stopped_early),
      planned_trial_count: runs.reduce(
        (total, run) => total + run.partialAccounting.planned_trial_count,
        0,
      ),
      discovered_completed_trial_count: runs.reduce(
        (total, run) => total + run.partialAccounting.discovered_completed_trial_count,
        0,
      ),
      included_trial_count: trials.length,
      excluded_completed_trial_count: runs.reduce(
        (total, run) => total + run.partialAccounting.excluded_completed_trial_count,
        0,
      ),
      stopped_early_missing_trial_count: runs.reduce(
        (total, run) => total + run.partialAccounting.stopped_early_missing_trial_count,
        0,
      ),
      excluded_or_missing_trial_count: runs.reduce(
        (total, run) => total + run.partialAccounting.excluded_or_missing_trial_count,
        0,
      ),
      input_runs: runs.map((run, index) => ({
        input_index: index + 1,
        ...run.partialAccounting,
      })),
    },
    confidence_classification_rules: {
      exploratory: "fewer than 30 trials or fewer than 5 distinct fixtures",
      directional: "30-99 trials or 5-9 distinct fixtures",
      expanded_not_definitive: "at least 100 trials across at least 10 distinct fixtures",
    },
    confidence_limitations: partialRun
      ? [...CONFIDENCE_LIMITATIONS, ...PARTIAL_RUN_LIMITATIONS]
      : CONFIDENCE_LIMITATIONS,
    aggregates: {
      overall: summarizeTrials(trials),
      by_candidate: sortedObject(
        [...byCandidate].map(([candidate, group]) => [candidate, summarizeTrials(group)]),
      ),
      by_fixture: sortedObject(
        [...byFixture].map(([fixture, group]) => [fixture, summarizeTrials(group)]),
      ),
      by_candidate_and_fixture: sortedObject(
        [...byCandidateFixture].map(([key, group]) => {
          const [candidate, fixture] = key.split("\u0000");
          return [`${candidate}/${fixture}`, summarizeTrials(group)];
        }),
      ),
    },
  };
}

function writeJsonAtomically(outputFile, value) {
  const destination = path.resolve(outputFile);
  const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) throw new Error("Refusing to replace an output symlink");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o644);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function syntheticTrial({
  benchmarkId,
  candidate,
  repetition,
  candidateConfig,
  advisor,
  directAccepted,
  reviewedAccepted,
  directScore,
  reviewedScore,
  directCost,
  reviewedCost,
  directCostCompleteness = COMPLETE_COST,
  reviewedCostCompleteness = COMPLETE_COST,
  schedule,
  sourceChanged = false,
}) {
  return {
    trial: "/private/tmp/do-not-emit",
    fingerprint: "do-not-emit-hash",
    session_id: "do-not-emit-token",
    raw_prompt: "do-not-emit-prompt",
    source: "do-not-emit-source",
    tokens: { secret: "do-not-emit-token-counts" },
    benchmark_id: benchmarkId,
    candidate,
    repetition,
    model: candidateConfig,
    advisor,
    ...(schedule ? { schedule } : {}),
    provenance: {
      direct_source_sha256: "a".repeat(64),
      reviewed_source_sha256: (sourceChanged ? "b" : "a").repeat(64),
    },
    routes: {
      direct: {
        status: "completed",
        evaluation: { score: directScore, quality_floor_passed: directAccepted },
        totals: {
          recomputed_cost_usd: directCost,
          cost_completeness: directCostCompleteness,
        },
      },
      reviewed: {
        status: "completed",
        evaluation: { score: reviewedScore, quality_floor_passed: reviewedAccepted },
        totals: {
          recomputed_cost_usd: reviewedCost,
          cost_completeness: reviewedCostCompleteness,
        },
      },
    },
    experiment_totals: {
      recomputed_cost_usd: reviewedCost,
      cost_completeness: reviewedCostCompleteness,
    },
  };
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paired-summary-self-test-"));
  const advisor = { model: "openai/gpt-5.6-sol", effort: "xhigh", variant: "xhigh" };
  const models = {
    luna: { model: "openai/gpt-5.6-luna", effort: "xhigh", variant: "xhigh" },
    terra: { model: "openai/gpt-5.6-terra", effort: "xhigh", variant: "xhigh" },
  };
  const outcomes = {
    "fixture-a": {
      luna: [[false, true, 69, 95, 0.1, 0.2], [true, true, 95, 95, 0.11, 0.21]],
      terra: [[true, false, 95, 70, 0.2, 0.31], [false, false, 60, 65, 0.21, 0.32]],
    },
    "fixture-b": {
      luna: [[true, true, 90, 94, 0.12, 0.22], [false, false, 70, 72, 0.13, 0.23]],
      terra: [[false, true, 65, 92, 0.22, 0.33], [true, true, 91, 93, 0.23, 0.34]],
    },
  };

  try {
    const inputDirs = [];
    for (const [benchmarkId, candidates] of Object.entries(outcomes)) {
      const directory = path.join(root, benchmarkId);
      fs.mkdirSync(directory);
      const metadata = {
        protocol: SUPPORTED_PROTOCOL,
        benchmark_id: benchmarkId,
        repeat: 2,
        selected: ["luna", "terra"],
        candidate_efforts: { luna: "xhigh", terra: "xhigh" },
        advisor,
      };
      const summary = Object.entries(candidates).flatMap(([candidate, repetitions]) =>
        repetitions.map((values, index) => syntheticTrial({
          benchmarkId,
          candidate,
          repetition: index + 1,
          candidateConfig: models[candidate],
          advisor,
          directAccepted: values[0],
          reviewedAccepted: values[1],
          directScore: values[2],
          reviewedScore: values[3],
          directCost: values[4],
          reviewedCost: values[5],
          sourceChanged: benchmarkId === "fixture-a" &&
            candidate === "luna" && index === 1,
        }))
      );
      fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify(metadata));
      fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary));
      inputDirs.push(directory);
    }

    const aggregate = summarizeInputDirs(inputDirs);
    if (aggregate.trial_count !== 8) throw new Error("unexpected trial count");
    if (aggregate.aggregates.overall.transitions.rescues !== 2) {
      throw new Error("unexpected rescue count");
    }
    if (aggregate.aggregates.overall.transitions.harms !== 1) {
      throw new Error("unexpected harm count");
    }
    if (aggregate.aggregates.by_candidate.luna.routes.reviewed.quality_floor.accepted !== 3) {
      throw new Error("unexpected candidate acceptance count");
    }
    if (
      aggregate.aggregates.overall.costs_usd.counterfactual_reviewed
        .cost_per_accepted.interpretation !== "complete_for_observed_requests"
    ) {
      throw new Error("complete cost accounting was not propagated");
    }
    if (aggregate.aggregates.overall.revision_source_churn.changed_trials !== 1) {
      throw new Error("unexpected overall revision source churn count");
    }
    if (aggregate.aggregates.by_candidate.luna.revision_source_churn.changed_trials !== 1) {
      throw new Error("unexpected candidate revision source churn count");
    }
    if (
      aggregate.aggregates.overall.revision_source_churn
        .changed_with_unchanged_score.count !== 1
    ) {
      throw new Error("unchanged-quality revision source churn was not classified");
    }

    const partialDirectory = path.join(root, "partial-fixture");
    fs.mkdirSync(partialDirectory);
    const partialMetadata = {
      protocol: SUPPORTED_PROTOCOL,
      benchmark_id: "partial-fixture",
      seed: "partial-test-seed",
      repeat: 4,
      selected: ["luna", "terra"],
      candidate_efforts: { luna: "xhigh", terra: "xhigh" },
      advisor,
    };
    fs.writeFileSync(
      path.join(partialDirectory, "metadata.json"),
      JSON.stringify(partialMetadata),
    );
    const partialResults = [
      syntheticTrial({
        benchmarkId: "partial-fixture",
        candidate: "luna",
        repetition: 1,
        candidateConfig: models.luna,
        advisor,
        directAccepted: true,
        reviewedAccepted: true,
        directScore: 95,
        reviewedScore: 96,
        directCost: 0.1,
        reviewedCost: 0.2,
        directCostCompleteness: LOWER_BOUND_COST,
        reviewedCostCompleteness: LOWER_BOUND_COST,
        schedule: {
          seed: "partial-test-seed",
          selected_cohort: ["luna", "terra"],
          block: 1,
          order_position: 0,
        },
      }),
      syntheticTrial({
        benchmarkId: "partial-fixture",
        candidate: "terra",
        repetition: 1,
        candidateConfig: models.terra,
        advisor,
        directAccepted: true,
        reviewedAccepted: true,
        directScore: 94,
        reviewedScore: 95,
        directCost: 0.2,
        reviewedCost: 0.3,
        schedule: {
          seed: "partial-test-seed",
          selected_cohort: ["luna", "terra"],
          block: 1,
          order_position: 1,
        },
      }),
      syntheticTrial({
        benchmarkId: "partial-fixture",
        candidate: "luna",
        repetition: 2,
        candidateConfig: models.luna,
        advisor,
        directAccepted: false,
        reviewedAccepted: true,
        directScore: 70,
        reviewedScore: 90,
        directCost: 0.1,
        reviewedCost: 0.2,
        schedule: {
          seed: "partial-test-seed",
          selected_cohort: ["luna", "terra"],
          block: 2,
          order_position: 0,
        },
      }),
    ];
    for (const [index, result] of partialResults.entries()) {
      const resultDirectory = path.join(partialDirectory, `swift-result-${index + 1}`);
      fs.mkdirSync(resultDirectory);
      fs.writeFileSync(path.join(resultDirectory, "result.json"), JSON.stringify(result));
    }
    const partial = summarizeInputDirs([partialDirectory], { partialRun: true });
    if (partial.trial_count !== 2) throw new Error("partial prefix included an imbalanced trial");
    if (partial.partial_run.excluded_completed_trial_count !== 1) {
      throw new Error("partial completed exclusion count is wrong");
    }
    if (partial.partial_run.stopped_early_missing_trial_count !== 5) {
      throw new Error("partial stopped-early count is wrong");
    }
    if (partial.partial_run.excluded_or_missing_trial_count !== 6) {
      throw new Error("partial total exclusion count is wrong");
    }
    if (
      partial.aggregates.overall.costs_usd.counterfactual_direct
        .cost_per_accepted.interpretation !== "lower_bound"
    ) {
      throw new Error("incomplete cost per accepted was not labeled as a lower bound");
    }
    if (
      partial.aggregates.overall.costs_usd.incremental_advisor_and_revision
        .cost_completeness !== "unknown_difference_due_to_incomplete_stages"
    ) {
      throw new Error("incomplete incremental cost was not qualified");
    }
    const serialized = `${JSON.stringify(aggregate)}${JSON.stringify(partial)}`;
    for (const forbidden of [
      "do-not-emit",
      "session_id",
      "fingerprint",
      "raw_prompt",
      "sha256",
      "tokens",
    ]) {
      if (serialized.includes(forbidden)) {
        throw new Error(`sanitized aggregate retained forbidden content: ${forbidden}`);
      }
    }
    console.log("PASS paired trial summarizer synthetic sanitizer test");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.selfTest) {
    runSelfTest();
    return;
  }
  const aggregate = summarizeInputDirs(args.inputDirs, {
    partialRun: args.partialRun,
  });
  writeJsonAtomically(args.outputFile, aggregate);
  console.log(
    `WROTE ${aggregate.trial_count} paired trials across ${aggregate.fixture_count} fixtures`,
  );
}

main();
