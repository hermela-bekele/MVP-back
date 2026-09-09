/** Roles with institutional (not just self-service) access to staff records —
 * e.g. a teacher's personal contact details. Kept in one place so every route
 * and serializer that needs this check agrees on the same set. */
export const PRIVILEGED_STAFF_ROLES = new Set([
  'department-head',
  'head-of-academics',
  'school-head',
  'moe',
]);

export function isPrivilegedStaff(role: string): boolean {
  return PRIVILEGED_STAFF_ROLES.has(role);
}
