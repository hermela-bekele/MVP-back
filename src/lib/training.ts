// TR-007: the only rule that may mark a training module completed — ALL three of
// sessions, assessment, and reflection must be done. Never a single flag the client can
// set directly (see PATCH /teacher-training-assignments/:id, which explicitly rejects a
// client-supplied status of 'completed').
export function isTrainingAssignmentComplete(input: {
  sessionsCompleted: number;
  sessionsTotal?: number;
  assessmentPassed?: boolean;
  reflectionSubmitted: boolean;
}): boolean {
  const allSessionsDone = input.sessionsTotal != null && input.sessionsCompleted >= input.sessionsTotal;
  return allSessionsDone && input.assessmentPassed === true && input.reflectionSubmitted === true;
}

/** Derives the next assignment status from progress alone — 'completed' only once
 * isTrainingAssignmentComplete is true, 'in_progress' once any real progress exists,
 * otherwise unchanged. */
export function nextTrainingAssignmentStatus(input: {
  sessionsCompleted: number;
  sessionsTotal?: number;
  assessmentScore?: number;
  assessmentPassed?: boolean;
  reflectionSubmitted: boolean;
  currentStatus: string;
}): string {
  if (isTrainingAssignmentComplete(input)) return 'completed';
  if (input.sessionsCompleted > 0 || input.assessmentScore != null) return 'in_progress';
  return input.currentStatus;
}
