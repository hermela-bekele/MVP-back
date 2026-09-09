import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTrainingAssignmentOverdue, mapTeacher } from './serialize.js';

// TR-005: late status is derived from the due date, never stored, so it can never go
// stale — and a completed assignment is never "late" no matter how far past due it was
// finished.
test('isTrainingAssignmentOverdue: true once the due date has passed and it is not completed', () => {
  const today = new Date('2026-06-15T00:00:00Z');
  assert.equal(isTrainingAssignmentOverdue('in_progress', '2026-06-01', today), true);
  assert.equal(isTrainingAssignmentOverdue('assigned', '2026-06-14', today), true);
});

test('isTrainingAssignmentOverdue: false while the due date has not yet passed', () => {
  const today = new Date('2026-06-15T00:00:00Z');
  assert.equal(isTrainingAssignmentOverdue('in_progress', '2026-06-16', today), false);
  assert.equal(isTrainingAssignmentOverdue('assigned', '2026-06-15', today), false);
});

test('isTrainingAssignmentOverdue: false once completed, regardless of due date', () => {
  const today = new Date('2026-06-15T00:00:00Z');
  assert.equal(isTrainingAssignmentOverdue('completed', '2026-01-01', today), false);
});

test('isTrainingAssignmentOverdue: false when there is no due date at all', () => {
  const today = new Date('2026-06-15T00:00:00Z');
  assert.equal(isTrainingAssignmentOverdue('in_progress', undefined, today), false);
});

// PR-002: a teacher's personal phone is masked for everyone except the teacher
// themselves and privileged staff — enforced server-side in the serializer, not merely
// hidden by the frontend.
test('mapTeacher: phone included when maskPersonalContact is false (self or privileged caller)', () => {
  const row = { id: 'tch-1', name: 'Martha Feyissa', email: 'martha@example.com', phone: '+251-911-000000' };
  const mapped = mapTeacher(row, { maskPersonalContact: false });
  assert.equal(mapped.phone, '+251-911-000000');
  assert.equal(mapped.email, 'martha@example.com');
});

test('mapTeacher: phone masked to null when maskPersonalContact is true (parent/peer/student caller)', () => {
  const row = { id: 'tch-1', name: 'Martha Feyissa', email: 'martha@example.com', phone: '+251-911-000000' };
  const mapped = mapTeacher(row, { maskPersonalContact: true });
  assert.equal(mapped.phone, null);
  // Email is the institutional/login identifier — never masked.
  assert.equal(mapped.email, 'martha@example.com');
});

test('mapTeacher: phone included by default when no options are passed', () => {
  const row = { id: 'tch-1', name: 'Martha Feyissa', email: 'martha@example.com', phone: '+251-911-000000' };
  const mapped = mapTeacher(row);
  assert.equal(mapped.phone, '+251-911-000000');
});
