import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeOverallAverage, computeRankings, computeSubjectAverage, percentToLetterGrade } from './academicResults.js';

test('computeSubjectAverage: weighted average of scores', () => {
  const avg = computeSubjectAverage([
    { score: 80, maxScore: 100, weight: 1 },
    { score: 45, maxScore: 50, weight: 2 },
  ]);
  // (80*1 + 90*2) / 3 = 86.666...
  assert.equal(avg, 86.67);
});

test('computeSubjectAverage: no entries returns null', () => {
  assert.equal(computeSubjectAverage([]), null);
});

test('computeSubjectAverage: zero total weight returns null, not NaN/Infinity', () => {
  assert.equal(computeSubjectAverage([{ score: 10, maxScore: 10, weight: 0 }]), null);
});

test('computeSubjectAverage: zero maxScore entry contributes 0%, not divide-by-zero', () => {
  const avg = computeSubjectAverage([
    { score: 0, maxScore: 0, weight: 1 },
    { score: 100, maxScore: 100, weight: 1 },
  ]);
  assert.equal(avg, 50);
});

test('computeOverallAverage: averages subject averages, excluding missing ones', () => {
  assert.equal(computeOverallAverage([90, 80, null, undefined, 70]), 80);
});

test('computeOverallAverage: all missing returns null', () => {
  assert.equal(computeOverallAverage([null, undefined]), null);
});

test('percentToLetterGrade: resolves band, null when no percent', () => {
  const scale = [
    { minPercent: 90, maxPercent: 100, letter: 'A' },
    { minPercent: 0, maxPercent: 89, letter: 'B' },
  ];
  assert.equal(percentToLetterGrade(95, scale), 'A');
  assert.equal(percentToLetterGrade(50, scale), 'B');
  assert.equal(percentToLetterGrade(null, scale), null);
});

test('computeRankings: ties share a rank, next rank skips (95,95,93 -> 1,1,3)', () => {
  const result = computeRankings([
    { id: 'a', average: 95 },
    { id: 'b', average: 95 },
    { id: 'c', average: 93 },
  ]);
  const byId = Object.fromEntries(result.map((r) => [r.id, r]));
  assert.equal(byId.a.rank, 1);
  assert.equal(byId.b.rank, 1);
  assert.equal(byId.c.rank, 3);
  assert.equal(byId.a.population, 3);
});

test('computeRankings: students with no average are excluded from population but returned with rank null', () => {
  const result = computeRankings([
    { id: 'a', average: 90 },
    { id: 'b', average: null },
  ]);
  const byId = Object.fromEntries(result.map((r) => [r.id, r]));
  assert.equal(byId.a.rank, 1);
  assert.equal(byId.a.population, 1);
  assert.equal(byId.b.rank, null);
  assert.equal(byId.b.population, 1);
});

test('computeRankings: empty population', () => {
  assert.deepEqual(computeRankings([]), []);
});
