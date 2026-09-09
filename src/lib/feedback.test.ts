import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveFeedbackAuthorRole,
  resolveFeedbackCategory,
  isAnonymousFeedback,
} from './feedback.js';

// FB-001: evidence source — never trust the client's claimed role, always derive from
// the authenticated caller's actual role.
test('resolveFeedbackAuthorRole: maps each caller role to its real evidence source', () => {
  assert.equal(resolveFeedbackAuthorRole('teacher'), 'peer');
  assert.equal(resolveFeedbackAuthorRole('department-head'), 'department-head');
  assert.equal(resolveFeedbackAuthorRole('parent'), 'parent');
  assert.equal(resolveFeedbackAuthorRole('student'), 'student');
});

test('resolveFeedbackAuthorRole: a role with no feedback-giving right resolves to null', () => {
  assert.equal(resolveFeedbackAuthorRole('school-head'), null);
  assert.equal(resolveFeedbackAuthorRole('moe'), null);
  assert.equal(resolveFeedbackAuthorRole('registrar'), null);
});

// FB-003: feedback categories — each source has a fixed, non-negotiable category except
// department-head, which chooses among a fixed set (never an arbitrary client string).
test('resolveFeedbackCategory: peer feedback is always informal_peer', () => {
  assert.equal(resolveFeedbackCategory('peer'), 'informal_peer');
  assert.equal(resolveFeedbackCategory('peer', 'formal_performance'), 'informal_peer');
});

test('resolveFeedbackCategory: student feedback is always anonymous_survey', () => {
  assert.equal(resolveFeedbackCategory('student'), 'anonymous_survey');
  assert.equal(resolveFeedbackCategory('student', 'coaching'), 'anonymous_survey');
});

test('resolveFeedbackCategory: department-head may choose among the three real categories', () => {
  assert.equal(resolveFeedbackCategory('department-head', 'classroom_observation'), 'classroom_observation');
  assert.equal(resolveFeedbackCategory('department-head', 'formal_performance'), 'formal_performance');
  assert.equal(resolveFeedbackCategory('department-head', 'coaching'), 'coaching');
});

test('resolveFeedbackCategory: department-head with an invalid/unrecognized category falls back to coaching, not the raw client value', () => {
  assert.equal(resolveFeedbackCategory('department-head', 'anonymous_survey'), 'coaching');
  assert.equal(resolveFeedbackCategory('department-head', 'made-up-category'), 'coaching');
  assert.equal(resolveFeedbackCategory('department-head', undefined), 'coaching');
});

test('resolveFeedbackCategory: parent feedback has no formal category', () => {
  assert.equal(resolveFeedbackCategory('parent'), null);
});

// FB-002: anonymity — allowed ONLY for student feedback directed at a teacher.
test('isAnonymousFeedback: true only for to_teacher + student', () => {
  assert.equal(isAnonymousFeedback('to_teacher', 'student'), true);
});

test('isAnonymousFeedback: false for peer, parent, and department-head feedback', () => {
  assert.equal(isAnonymousFeedback('to_teacher', 'peer'), false);
  assert.equal(isAnonymousFeedback('to_teacher', 'parent'), false);
  assert.equal(isAnonymousFeedback('to_teacher', 'department-head'), false);
});

test('isAnonymousFeedback: false for student feedback in the other direction (e.g. from_teacher)', () => {
  assert.equal(isAnonymousFeedback('from_teacher', 'student'), false);
});

test('isAnonymousFeedback: false when author role is missing entirely', () => {
  assert.equal(isAnonymousFeedback('to_teacher', undefined), false);
  assert.equal(isAnonymousFeedback('to_teacher', null), false);
});
