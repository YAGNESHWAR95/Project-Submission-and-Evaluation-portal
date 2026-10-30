import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getConfirmedStageUpload,
  getStageSubmissionEligibility,
  getStageUploadGate,
  canEditStageControl,
  isStageRevisionItemAuthorized,
} from './stageSubmissionState.js';

test('selected files do not enable submission until the server confirms every required upload', () => {
  const firstUpload = getConfirmedStageUpload({
    status: 'success', version: 1, url: '/report.pdf', originalName: 'Mini_Project_Report.pdf',
  });
  const partial = getStageSubmissionEligibility({
    latest: null,
    uploads: { report: firstUpload },
    requiredPurposes: ['report', 'presentation'],
    canUpload: true,
    phase: 'abstract',
  });

  assert.equal(partial.filesReady, false);
  assert.equal(partial.canSubmit, false);
});

test('successful uploads immediately make an eligible complete Review 1 draft submittable', () => {
  const eligibility = getStageSubmissionEligibility({
    latest: null,
    uploads: {
      report: getConfirmedStageUpload({ status: 'success', version: 1, url: '/report.pdf' }),
      presentation: getConfirmedStageUpload({ status: 'success', version: 1, url: '/presentation.pptx' }),
    },
    requiredPurposes: ['report', 'presentation'],
    canUpload: true,
    phase: 'abstract',
  });

  assert.equal(eligibility.submission.status, 'draft');
  assert.equal(eligibility.filesReady, true);
  assert.equal(eligibility.canSubmit, true);
});

test('failed uploads cannot unlock submission and locked later stages remain ineligible', () => {
  assert.equal(getConfirmedStageUpload({ status: 'error', message: 'rejected' }), null);
  assert.equal(isStageRevisionItemAuthorized(false, [], 'report'), true);
  assert.equal(isStageRevisionItemAuthorized(true, ['report'], 'report'), true);
  assert.equal(isStageRevisionItemAuthorized(true, ['report'], 'presentation'), false);
  assert.equal(canEditStageControl(false), false);
  assert.equal(canEditStageControl(true, false), false);
  assert.equal(canEditStageControl(true, true), true);

  const locked = getStageSubmissionEligibility({
    latest: { version: 1, status: 'draft', files: { reportUrl: '/report', pptUrl: '/slides' } },
    requiredPurposes: ['report', 'presentation'],
    canUpload: false,
    phase: 'midterm',
  });
  assert.equal(locked.canSubmit, false);
});

test('pending proposal approval and a deadline tagged for another phase keep Review 1 uploads disabled', () => {
  const gate = getStageUploadGate({
    isLeader: true,
    proposalApproved: false,
    deadlineAvailable: false,
    deadlineOpen: false,
    revisionDeadlineOpen: false,
    prerequisiteMet: true,
    editableStatus: true,
    revisionWaitingForGrant: false,
    phase: 'abstract',
    projectBatch: 'Batch 2026',
    misconfiguredDeadline: { title: 'Early Abstract Review', phase: 'final' },
  });

  assert.equal(gate.canUpload, false);
  assert.match(gate.blockedReasons.join(' '), /Proposal approval is required/);
  assert.match(gate.blockedReasons.join(' '), /Early Abstract Review.*configured as final, not abstract/);
});