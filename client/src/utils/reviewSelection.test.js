import test from 'node:test';
import assert from 'node:assert/strict';
import { getReviewModalState, getSelectedVersionFileReference, isValidReviewSubmission } from './reviewSelection.js';

test('formal review selection reports loading/unavailable states before controls render', () => {
  assert.equal(getReviewModalState({ isOpen: false }), 'closed');
  assert.equal(getReviewModalState({ isOpen: true, project: null }), 'project-unavailable');
  assert.equal(getReviewModalState({ isOpen: true, project: { _id: 'p1' }, submission: null }), 'submission-unavailable');
  assert.equal(getReviewModalState({ isOpen: true, project: { _id: 'p1' }, submission: null, proposalOnly: true }), 'ready');
  assert.equal(isValidReviewSubmission({ phase: 'abstract', version: 1, status: 'submitted' }), true);
  assert.equal(isValidReviewSubmission({ phase: null, version: 1, status: 'submitted' }), false);
});

test('file references retain the selected phase and version for authenticated downloads', () => {
  const submission = {
    phase: 'midterm',
    version: 3,
    files: { reportUrl: '/secure/report', reportName: 'midterm-v3.pdf' },
  };
  assert.deepEqual(getSelectedVersionFileReference('project-1', submission, 'report'), {
    projectId: 'project-1',
    purpose: 'report',
    phase: 'midterm',
    versionNumber: 3,
    filename: 'midterm-v3.pdf',
  });
  assert.equal(getSelectedVersionFileReference('project-1', submission, 'presentation'), null);
});

test('legacy final version zero uses the project-scoped legacy download reference', () => {
  assert.deepEqual(getSelectedVersionFileReference('project-1', {
    phase: 'final',
    version: 0,
    files: { reportUrl: '/legacy/report' },
  }, 'report'), {
    projectId: 'project-1',
    purpose: 'report',
    phase: undefined,
    versionNumber: undefined,
    filename: 'report-document',
  });
});