import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPrivilegedStaff } from './roles.js';

test('isPrivilegedStaff: true for institutional leadership roles', () => {
  assert.equal(isPrivilegedStaff('department-head'), true);
  assert.equal(isPrivilegedStaff('head-of-academics'), true);
  assert.equal(isPrivilegedStaff('school-head'), true);
  assert.equal(isPrivilegedStaff('moe'), true);
});

test('isPrivilegedStaff: false for a teacher and other non-leadership roles', () => {
  assert.equal(isPrivilegedStaff('teacher'), false);
  assert.equal(isPrivilegedStaff('student'), false);
  assert.equal(isPrivilegedStaff('parent'), false);
  assert.equal(isPrivilegedStaff('registrar'), false);
  assert.equal(isPrivilegedStaff('hr'), false);
});
