#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function argumentsByName(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new Error("Expected --grading-dir PATH --grader-files PATH[,PATH...]");
    }
    result[flag.slice(2).replaceAll("-", "_")] = value;
  }
  return result;
}

function median(values) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function normalizedGrader(document, file, packet) {
  if (Array.isArray(document)) {
    const scores = document
      .filter((entry) => entry && typeof entry === "object" && entry.answer)
      .map((entry) => ({
        ...entry,
        label: entry.answer.replace(/\.md$/, ""),
        fatal_cap: entry.fatal_cap ?? entry.caps_applied?.[0] ?? null,
        critical_error: entry.critical_error ?? entry.material_errors?.[0] ?? null,
      }));
    return {
      grader: path.basename(file, path.extname(file)),
      grades: { scores },
    };
  }
  const grades = document.packets?.find((candidate) =>
    candidate.packet === packet ||
    packet.includes(candidate.packet) ||
    candidate.packet.includes(packet)
  );
  if (!grades) throw new Error(`${file} has no packet named ${packet}`);
  return { grader: document.grader ?? path.basename(file, path.extname(file)), grades };
}

const args = argumentsByName(process.argv.slice(2));
if (!args.grading_dir || !args.grader_files) {
  throw new Error("Expected --grading-dir PATH --grader-files PATH[,PATH...]");
}

const gradingDir = path.resolve(args.grading_dir);
const packet = path.basename(gradingDir);
const key = JSON.parse(fs.readFileSync(path.join(gradingDir, "key.json"), "utf8"));
const graders = args.grader_files.split(",").map((file) => {
  const document = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return normalizedGrader(document, file, packet);
});

const answers = key.map((metadata) => {
  const gradeRows = graders.map(({ grader, grades }) => {
    const grade = grades.scores.find((candidate) => candidate.label === metadata.label);
    if (!grade) throw new Error(`${grader} has no score for ${metadata.label}`);
    return { grader, ...grade };
  });
  const scores = gradeRows.map((grade) => grade.score);
  return {
    ...metadata,
    scores,
    median_score: median(scores),
    score_range: Math.max(...scores) - Math.min(...scores),
    fatal_caps: gradeRows.map(({ grader, fatal_cap }) => ({ grader, fatal_cap })),
    critical_errors: gradeRows.map(({ grader, critical_error }) => ({
      grader,
      critical_error,
    })),
    grades: gradeRows,
  };
});

process.stdout.write(`${JSON.stringify({ packet, grader_count: graders.length, answers }, null, 2)}\n`);
