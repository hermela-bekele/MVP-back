// FB-002/FB-003: the evidence source (author role) and category are never trusted
// verbatim from the client — both are derived from the caller's authenticated role, so
// nobody can claim to be e.g. a department head to make their feedback carry more
// weight, or pick a category that doesn't make sense for who they actually are.

export const FEEDBACK_AUTHOR_ROLE_BY_CALLER: Record<string, string> = {
  teacher: 'peer',
  'department-head': 'department-head',
  parent: 'parent',
  student: 'student',
};

export const DEPT_HEAD_FEEDBACK_CATEGORIES = new Set(['coaching', 'classroom_observation', 'formal_performance']);

/** Resolves the real evidence source for a caller giving teacher feedback, or null if
 * their role may not give it at all (see FEEDBACK_AUTHOR_ROLE_BY_CALLER). */
export function resolveFeedbackAuthorRole(callerRole: string): string | null {
  return FEEDBACK_AUTHOR_ROLE_BY_CALLER[callerRole] ?? null;
}

/** Resolves the feedback category for a given author role. Peer and student feedback
 * each have exactly one legitimate, fixed category (FB-001: never mislabel a teacher's
 * peer note as "Student Feedback" or vice versa). Only a department head choosing to
 * give a coaching note, a classroom observation, or a formal performance review has a
 * real choice — and even then, only from that fixed set; anything else falls back to
 * 'coaching' rather than trusting an arbitrary client-supplied string. Parent feedback
 * carries no formal category (a note, not a formal evaluation). */
export function resolveFeedbackCategory(authorRole: string, requestedCategory?: string): string | null {
  if (authorRole === 'peer') return 'informal_peer';
  if (authorRole === 'student') return 'anonymous_survey';
  if (authorRole === 'department-head') {
    const requested = String(requestedCategory ?? '');
    return DEPT_HEAD_FEEDBACK_CATEGORIES.has(requested) ? requested : 'coaching';
  }
  return null;
}

/** FB-002: anonymous feedback is allowed ONLY for student feedback directed at a
 * teacher — never automatically applied to teacher, parent, or department-head
 * feedback, and never a client-supplied flag. */
export function isAnonymousFeedback(direction: string, authorRole: string | null | undefined): boolean {
  return direction === 'to_teacher' && authorRole === 'student';
}
