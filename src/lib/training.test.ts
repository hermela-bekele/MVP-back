import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTrainingAssignmentComplete, nextTrainingAssignmentStatus } from './training.js';

// TR-007: final completion rule — ALL of sessions, assessment, and reflection required.
test('isTrainingAssignmentComplete: true only when all three requirements are met', () => {
  assert.equal(
    isTrainingAssignmentComplete({
      sessionsCompleted: 3,
      sessionsTotal: 3,
      assessmentPassed: true,
      reflectionSubmitted: true,
    }),
    true,
  );
});

test('isTrainingAssignmentComplete: false if sessions are incomplete, even with assessment + reflection done', () => {
  assert.equal(
    isTrainingAssignmentComplete({
      sessionsCompleted: 2,
      sessionsTotal: 3,
      assessmentPassed: true,
      reflectionSubmitted: true,
    }),
    false,
  );
});

test('isTrainingAssignmentComplete: false if the assessment was not passed', () => {
  assert.equal(
    isTrainingAssignmentComplete({
      sessionsCompleted: 3,
      sessionsTotal: 3,
      assessmentPassed: false,
      reflectionSubmitted: true,
    }),
    false,
  );
});

test('isTrainingAssignmentComplete: false if the reflection was not submitted', () => {
  assert.equal(
    isTrainingAssignmentComplete({
      sessionsCompleted: 3,
      sessionsTotal: 3,
      assessmentPassed: true,
      reflectionSubmitted: false,
    }),
    false,
  );
});

test('isTrainingAssignmentComplete: false when sessionsTotal is unknown (never divides by an assumed total)', () => {
  assert.equal(
    isTrainingAssignmentComplete({
      sessionsCompleted: 5,
      sessionsTotal: undefined,
      assessmentPassed: true,
      reflectionSubmitted: true,
    }),
    false,
  );
});

test('nextTrainingAssignmentStatus: completed once all three requirements are met', () => {
  const status = nextTrainingAssignmentStatus({
    sessionsCompleted: 3,
    sessionsTotal: 3,
    assessmentScore: 90,
    assessmentPassed: true,
    reflectionSubmitted: true,
    currentStatus: 'in_progress',
  });
  assert.equal(status, 'completed');
});

test('nextTrainingAssignmentStatus: in_progress once any real progress exists but not yet complete', () => {
  const status = nextTrainingAssignmentStatus({
    sessionsCompleted: 1,
    sessionsTotal: 3,
    assessmentScore: undefined,
    assessmentPassed: undefined,
    reflectionSubmitted: false,
    currentStatus: 'assigned',
  });
  assert.equal(status, 'in_progress');
});

test('nextTrainingAssignmentStatus: stays at currentStatus when there is no progress at all', () => {
  const status = nextTrainingAssignmentStatus({
    sessionsCompleted: 0,
    sessionsTotal: 3,
    assessmentScore: undefined,
    assessmentPassed: undefined,
    reflectionSubmitted: false,
    currentStatus: 'assigned',
  });
  assert.equal(status, 'assigned');
});
