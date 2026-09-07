/**
 * Centralized academic-result calculations. The single source of truth for subject
 * averages, overall averages and rankings — every route that needs these numbers
 * (submit, finalize, report-card, transcript) calls into here rather than recomputing.
 */

export interface GradeEntryLike {
  score: number;
  maxScore: number;
  weight: number;
}

/** Weighted average as a 0-100 percentage, or null if there's nothing to average. */
export function computeSubjectAverage(entries: GradeEntryLike[]): number | null {
  if (entries.length === 0) return null;
  const totalWeight = entries.reduce((a, e) => a + Number(e.weight), 0);
  if (totalWeight === 0) return null;
  const weighted = entries.reduce((a, e) => {
    const max = Number(e.maxScore);
    const pct = max > 0 ? (Number(e.score) / max) * 100 : 0;
    return a + pct * Number(e.weight);
  }, 0);
  return Math.round((weighted / totalWeight) * 100) / 100;
}

/**
 * A student's overall term average is the average of their subject averages.
 * Missing subjects are excluded, never treated as zero.
 */
export function computeOverallAverage(subjectAverages: (number | null | undefined)[]): number | null {
  const values = subjectAverages.filter((v): v is number => v != null);
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

export function percentToLetterGrade(
  percent: number | null,
  scale: { minPercent: number; maxPercent: number; letter: string }[],
): string | null {
  if (percent == null) return null;
  const band = scale.find((b) => percent >= b.minPercent && percent <= b.maxPercent);
  return band?.letter ?? null;
}

export interface RankInput {
  id: string;
  average: number | null;
}

export interface RankResult {
  id: string;
  average: number | null;
  rank: number | null;
  population: number;
}

/**
 * Standard competition ranking: equal averages share the same rank, and the next
 * distinct rank skips accordingly (95, 95, 93 -> 1, 1, 3). Students with no average
 * (missing results) are excluded from the ranking population but still returned with
 * rank: null so callers can render "—" for them.
 */
export function computeRankings(students: RankInput[]): RankResult[] {
  const ranked = students.filter((s) => s.average != null);
  const population = ranked.length;
  const sorted = [...ranked].sort((a, b) => (b.average as number) - (a.average as number));

  const rankById = new Map<string, number>();
  let lastAverage: number | null = null;
  let lastRank = 0;
  sorted.forEach((s, idx) => {
    if (s.average !== lastAverage) {
      lastRank = idx + 1;
      lastAverage = s.average;
    }
    rankById.set(s.id, lastRank);
  });

  return students.map((s) => ({
    id: s.id,
    average: s.average,
    rank: s.average != null ? rankById.get(s.id) ?? null : null,
    population,
  }));
}
