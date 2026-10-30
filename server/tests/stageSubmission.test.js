const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Project = require('../src/models/Project');
const Deadline = require('../src/models/Deadline');
const Evaluation = require('../src/models/Evaluation');
const projectController = require('../src/controllers/projectController');
const evaluationController = require('../src/controllers/evalController');

const uploadDirectory = path.resolve(__dirname, '../uploads');
const originalProjectFindById = Project.findById;
const originalProjectFind = Project.find;
const originalProjectCountDocuments = Project.countDocuments;
const originalDeadlineFindOne = Deadline.findOne;
const originalDeadlineFind = Deadline.find;

const createPdf = (text) => {
  const words = text.split(/\s+/);
  const lines = [];
  for (let index = 0; index < words.length; index += 6) lines.push(words.slice(index, index + 6).join(' '));
  const stream = lines.map((line, index) => `BT /F1 12 Tf 20 ${120 - index * 12} Td (${line}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
};

const makeResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader() {},
});

const withModels = async (project, deadline, run) => {
  Project.findById = async () => project;
  Project.find = async () => [];
  Deadline.findOne = async (query) => {
    withModels.lastDeadlineQuery = query;
    return deadline;
  };
  try {
    await run();
  } finally {
    Project.findById = originalProjectFindById;
    Project.find = originalProjectFind;
    Deadline.findOne = originalDeadlineFindOne;
  }
};

const makeDeadline = (endDate = new Date(Date.now() + 86400000)) => ({
  batch: 'Batch 2026',
  phase: 'abstract',
  isActive: true,
  submissionStartDate: new Date(Date.now() - 86400000),
  submissionEndDate: endDate,
});

test('uniqueness-checked proposals stay in proposal review and are excluded from formal submissions', async () => {
  const proposal = { _id: 'proposal-only', status: 'uniqueness_checked', assignedFaculty: 'faculty-1', files: {}, stageSubmissions: [] };
  const createProjectQuery = (items) => ({
    populate() { return this; },
    sort() { return this; },
    limit: async () => items,
    then(resolve, reject) { return Promise.resolve(items).then(resolve, reject); },
  });
  Project.find = () => createProjectQuery([proposal]);
  try {
    const formalResponse = makeResponse();
    await projectController.getFacultyReviewProjects(
      { user: { id: 'faculty-1', role: 'faculty' } }, formalResponse, (error) => { throw error; },
    );
    assert.deepEqual(formalResponse.body.submissions, []);

    const proposalResponse = makeResponse();
    await projectController.getProposalReviewProjects(
      { user: { id: 'faculty-1', role: 'faculty' } }, proposalResponse, (error) => { throw error; },
    );
    assert.equal(proposalResponse.body.projects[0].status, 'uniqueness_checked');
  } finally {
    Project.find = originalProjectFind;
  }
});

test('abstract stage uploads reject pending proposals and require an abstract-phase deadline', async () => {
  const project = {
    _id: 'abstract-upload-gate-project',
    leader: 'leader-1',
    batch: 'Batch 2026',
    status: 'faculty_review',
    stageSubmissions: [],
  };
  const originalFindById = Project.findById;
  const originalDeadlineFindOne = Deadline.findOne;
  const request = {
    params: { id: project._id, phase: 'abstract' },
    body: { purpose: 'report' },
    user: { id: 'leader-1', role: 'student' },
    file: {
      path: path.join(uploadDirectory, 'abstract-upload-gate.pdf'),
      filename: 'abstract-upload-gate.pdf',
      originalname: 'Mini_Project_Report.pdf',
      mimetype: 'application/pdf',
      size: 100,
    },
  };

  Project.findById = async () => project;
  let deadlineQueried = false;
  Deadline.findOne = async (query) => {
    deadlineQueried = true;
    assert.equal(query.phase, 'abstract');
    return null;
  };
  try {
    let proposalError;
    await projectController.uploadStageFile(request, makeResponse(), (error) => { proposalError = error; });
    assert.equal(proposalError.statusCode, 400);
    assert.equal(proposalError.message, 'Proposal approval is required before stage documents can be submitted');
    assert.equal(deadlineQueried, false);

    project.status = 'faculty_accepted';
    let deadlineError;
    await projectController.uploadStageFile(request, makeResponse(), (error) => { deadlineError = error; });
    assert.equal(deadlineError.statusCode, 404);
    assert.equal(deadlineError.message, 'No active abstract submission deadline is configured for this cohort');
  } finally {
    Project.findById = originalFindById;
    Deadline.findOne = originalDeadlineFindOne;
  }
});

test('abstract upload, review, granted revision, and resubmission preserve both document versions', async () => {
  const projectId = `stage-${crypto.randomUUID()}`;
  const firstFilename = `abstract-v1-${crypto.randomUUID()}.pdf`;
  const secondFilename = `abstract-v2-${crypto.randomUUID()}.pdf`;
  const midtermFilename = `midterm-v1-${crypto.randomUUID()}.pdf`;
  const firstPath = path.join(uploadDirectory, firstFilename);
  const secondPath = path.join(uploadDirectory, secondFilename);
  const midtermPath = path.join(uploadDirectory, midtermFilename);
  fs.writeFileSync(firstPath, createPdf('The initial abstract describes the proposed learning support system, its student facing outcomes, and the evaluation goals for instructors across courses during the first academic year.'));
  fs.writeFileSync(secondPath, createPdf('The revised abstract clarifies the proposed learning support system, its student facing outcomes, and the evaluation goals for instructors across courses during the first academic year after faculty feedback.'));
  fs.writeFileSync(midtermPath, createPdf('The midterm progress report documents completed system architecture, database structure, integration testing, and remaining implementation work for the student support portal.'));

  const project = {
    _id: projectId,
    leader: 'leader-1',
    teamMembers: ['leader-1'],
    assignedFaculty: 'faculty-1',
    batch: 'Batch 2026',
    status: 'faculty_accepted',
    stageWorkflowEnabled: true,
    stageSubmissions: [],
    files: {},
    save: async function () { return this; },
  };
  const deadline = makeDeadline();

  try {
    await withModels(project, deadline, async () => {
      const uploadResponse = makeResponse();
      await projectController.uploadStageFile({
        params: { id: projectId, phase: 'abstract' },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: { path: firstPath, filename: firstFilename, originalname: 'abstract.pdf', mimetype: 'application/pdf', size: fs.statSync(firstPath).size },
      }, uploadResponse, (error) => { throw error; });
      assert.equal(uploadResponse.body.version, 1);
      assert.equal(project.stageSubmissions[0].files.reportTextStatus, 'available');
      assert.ok(project.stageSubmissions[0].files.reportText.trim().split(/\s+/).length >= 20, project.stageSubmissions[0].files.reportText);
      project.stageSubmissions[0].files.pptUrl = '/abstract-slides-v1';

      const submitResponse = makeResponse();
      await projectController.submitStage(
        { params: { id: projectId, phase: 'abstract' }, user: { id: 'leader-1', role: 'student' } },
        submitResponse,
        (error) => { throw error; },
      );
      assert.equal(submitResponse.body.submission.status, 'submitted');
      assert.equal(submitResponse.body.submission.reportOriginality.status, 'no_comparisons');

      const requestResponse = makeResponse();
      const dueDate = new Date(Date.now() + 2 * 86400000);
      await projectController.reviewStageSubmission({
        params: { id: projectId, phase: 'abstract', version: '1' },
        body: { decision: 'changes_requested', feedback: 'Clarify the evaluation method.', revisionFileTypes: ['report'], revisionDueDate: dueDate.toISOString() },
        user: { id: 'faculty-1', role: 'faculty' },
      }, requestResponse, (error) => { throw error; });
      assert.equal(requestResponse.body.submission.status, 'changes_requested');

      let revisionQueueProjects = [project];
      Project.find = () => ({
        populate() { return this; },
        sort() { return this; },
        limit: async () => revisionQueueProjects,
      });
      const grantQueueResponse = makeResponse();
      await projectController.getFacultyReviewProjects(
        { user: { id: 'faculty-1', role: 'faculty' } }, grantQueueResponse, (error) => { throw error; },
      );
      assert.equal(grantQueueResponse.body.submissions[0].status, 'changes_requested');

      deadline.submissionEndDate = new Date(Date.now() - 86400000);
      const grantResponse = makeResponse();
      await projectController.grantStageRevisionAccess({
        params: { id: projectId, phase: 'abstract', version: '1' },
        user: { id: 'faculty-1', role: 'faculty' },
      }, grantResponse, (error) => { throw error; });
      assert.equal(grantResponse.body.submission.revisionAccessGranted, true);
      Project.find = async () => [];

      let unauthorizedRevisionFileError;
      await projectController.uploadStageFile({
        params: { id: projectId, phase: 'abstract' },
        body: { purpose: 'presentation' },
        user: { id: 'leader-1', role: 'student' },
        file: {
          path: path.join(uploadDirectory, `unauthorized-${crypto.randomUUID()}.pptx`),
          filename: `unauthorized-${crypto.randomUUID()}.pptx`,
          originalname: 'unauthorized.pptx',
          mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          size: 100,
        },
      }, makeResponse(), (error) => { unauthorizedRevisionFileError = error; });
      assert.equal(unauthorizedRevisionFileError.statusCode, 403);
      assert.match(unauthorizedRevisionFileError.message, /did not authorize/);

      const revisionUploadResponse = makeResponse();
      await projectController.uploadStageFile({
        params: { id: projectId, phase: 'abstract' },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: { path: secondPath, filename: secondFilename, originalname: 'abstract-revised.pdf', mimetype: 'application/pdf', size: fs.statSync(secondPath).size },
      }, revisionUploadResponse, (error) => { throw error; });
      assert.equal(revisionUploadResponse.body.version, 2);
      project.stageSubmissions[1].files.pptUrl = '/abstract-slides-v2';

      const repeatedRevisionUpload = makeResponse();
      await projectController.uploadStageFile({
        params: { id: projectId, phase: 'abstract' },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: { path: secondPath, filename: secondFilename, originalname: 'abstract-revised-again.pdf', mimetype: 'application/pdf', size: fs.statSync(secondPath).size },
      }, repeatedRevisionUpload, (error) => { throw error; });
      assert.equal(repeatedRevisionUpload.body.version, 2);
      assert.equal(project.stageSubmissions.length, 2);

      const resubmitResponse = makeResponse();
      await projectController.submitStage(
        { params: { id: projectId, phase: 'abstract' }, user: { id: 'leader-1', role: 'student' } },
        resubmitResponse,
        (error) => { throw error; },
      );
      assert.equal(resubmitResponse.body.submission.status, 'resubmitted');
      assert.equal(resubmitResponse.body.submission.reportOriginality.reportHash, project.stageSubmissions[1].files.reportHash);
      assert.notEqual(project.stageSubmissions[0].reportOriginality.reportHash, project.stageSubmissions[1].reportOriginality.reportHash);
      assert.equal(project.stageSubmissions[0].revisionAccessGranted, false);
      assert.equal(fs.existsSync(firstPath), true);

      let stageQueueProjects = [project];
      Project.find = () => ({
        populate() { return this; },
        sort() { return this; },
        limit: async () => stageQueueProjects,
      });
      const queueResponse = makeResponse();
      await projectController.getFacultyReviewProjects(
        { user: { id: 'faculty-1', role: 'faculty' } }, queueResponse, (error) => { throw error; },
      );
      assert.equal(queueResponse.body.submissions.length, 1);
      assert.equal(queueResponse.body.submissions[0].version, 2);
      Project.find = async () => [];

      let downloaded;
      let unauthorizedDownloadError;
      await projectController.downloadProjectFile({
        params: { id: projectId, purpose: 'report' },
        query: { stagePhase: 'abstract', versionNumber: '1' },
        user: { id: 'other-faculty', role: 'faculty' },
      }, {
        setHeader() {},
        download() { assert.fail('unassigned faculty must not receive a file'); },
      }, (error) => { unauthorizedDownloadError = error; });
      assert.equal(unauthorizedDownloadError.statusCode, 403);

      await projectController.downloadProjectFile({
        params: { id: projectId, purpose: 'report' },
        query: { stagePhase: 'abstract', versionNumber: '1' },
        user: { id: 'faculty-1', role: 'faculty' },
      }, {
        setHeader() {},
        download(filePath, filename) { downloaded = { filePath, filename }; },
      }, (error) => { throw error; });
      assert.equal(downloaded.filePath, fs.realpathSync(firstPath));

      let unsignedApprovalError;
      await projectController.reviewStageSubmission({
        params: { id: projectId, phase: 'abstract', version: '2' },
        body: { decision: 'approved', feedback: 'Abstract approved.' },
        user: { id: 'faculty-1', role: 'faculty' },
      }, makeResponse(), (error) => { unsignedApprovalError = error; });
      assert.equal(unsignedApprovalError.statusCode, 400);
      assert.match(unsignedApprovalError.message, /rubric evaluation/);
      project.stageSubmissions[1].rubricEvaluation = {
        isPublished: true,
        totalScore: 25,
        scores: [
          { criteriaName: 'Novelty & Scope', maxMarks: 10, scoredMarks: 8 },
          { criteriaName: 'Literature Survey', maxMarks: 10, scoredMarks: 8 },
          { criteriaName: 'SRS Document Quality', maxMarks: 10, scoredMarks: 9 },
        ],
      };
      const abstractApproval = makeResponse();
      await projectController.reviewStageSubmission({
        params: { id: projectId, phase: 'abstract', version: '2' },
        body: { decision: 'approved', feedback: 'Abstract approved.' },
        user: { id: 'faculty-1', role: 'faculty' },
      }, abstractApproval, (error) => { throw error; });
      assert.equal(abstractApproval.body.submission.status, 'approved');

      deadline.phase = 'midterm';
      deadline.submissionEndDate = new Date(Date.now() + 86400000);
      const midtermUploadResponse = makeResponse();
      await projectController.uploadStageFile({
        params: { id: projectId, phase: 'midterm' },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: { path: midtermPath, filename: midtermFilename, originalname: 'midterm.pdf', mimetype: 'application/pdf', size: fs.statSync(midtermPath).size },
      }, midtermUploadResponse, (error) => { throw error; });
      project.stageSubmissions[2].files.pptUrl = '/midterm-slides-v1';
      const midtermSubmitResponse = makeResponse();
      await projectController.submitStage(
        { params: { id: projectId, phase: 'midterm' }, user: { id: 'leader-1', role: 'student' } },
        midtermSubmitResponse,
        (error) => { throw error; },
      );
      assert.equal(midtermSubmitResponse.body.submission.status, 'submitted');
    });
  } finally {
    fs.rmSync(firstPath, { force: true });
    fs.rmSync(secondPath, { force: true });
    fs.rmSync(midtermPath, { force: true });
  }
});

test('rubric evaluations are bound to their stage version and preserve prior scores', async () => {
  const project = {
    _id: 'versioned-rubric-project',
    assignedFaculty: 'faculty-1',
    status: 'faculty_accepted',
    stageSubmissions: [{
      phase: 'abstract',
      version: 1,
      status: 'submitted',
      files: { reportUrl: '/report-v1' },
    }],
    save: async function () { return this; },
  };
  const originalProjectFindById = Project.findById;
  const originalEvaluationFindOne = Evaluation.findOne;
  const originalEvaluationCreate = Evaluation.create;
  Project.findById = () => ({ populate: async () => project });
  let evaluation = null;
  Evaluation.findOne = async () => evaluation;
  Evaluation.create = async (data) => {
    evaluation = { ...data, _id: 'evaluation-1', save: async function () { return this; } };
    return evaluation;
  };

  try {
    let unauthorizedGradeError;
    await evaluationController.submitEvaluation({
      body: {
        projectId: project._id,
        phase: 'abstract',
        submissionVersion: 1,
        scores: [
          { criteriaName: 'Novelty & Scope', maxMarks: 10, scoredMarks: 8 },
          { criteriaName: 'Literature Survey', maxMarks: 10, scoredMarks: 7 },
          { criteriaName: 'SRS Document Quality', maxMarks: 10, scoredMarks: 9 },
        ],
      },
      user: { id: 'faculty-2', role: 'faculty' },
    }, makeResponse(), (error) => { unauthorizedGradeError = error; });
    assert.equal(unauthorizedGradeError.statusCode, 403);
    assert.equal(evaluation, null);

    let invalidScoreError;
    await evaluationController.submitEvaluation({
      body: {
        projectId: project._id,
        phase: 'abstract',
        submissionVersion: 1,
        scores: [
          { criteriaName: 'Novelty & Scope', maxMarks: 10, scoredMarks: 11 },
          { criteriaName: 'Literature Survey', maxMarks: 10, scoredMarks: 7 },
          { criteriaName: 'SRS Document Quality', maxMarks: 10, scoredMarks: 9 },
        ],
      },
      user: { id: 'faculty-1', role: 'faculty' },
    }, makeResponse(), (error) => { invalidScoreError = error; });
    assert.equal(invalidScoreError.statusCode, 400);
    assert.equal(evaluation, null);

    const firstResponse = makeResponse();
    await evaluationController.submitEvaluation({
      body: {
        projectId: project._id,
        phase: 'abstract',
        submissionVersion: 1,
        scores: [
          { criteriaName: 'Novelty & Scope', maxMarks: 10, scoredMarks: 8 },
          { criteriaName: 'Literature Survey', maxMarks: 10, scoredMarks: 7 },
          { criteriaName: 'SRS Document Quality', maxMarks: 10, scoredMarks: 9 },
        ],
        feedback: 'Version one feedback',
        isPublished: false,
      },
      user: { id: 'faculty-1', role: 'faculty' },
    }, firstResponse, (error) => { throw error; });
    assert.equal(firstResponse.body.evaluation.submissionVersion, 1);
    assert.equal(project.stageSubmissions[0].rubricEvaluation.feedback, 'Version one feedback');

    project.stageSubmissions.push({
      phase: 'abstract',
      version: 2,
      status: 'resubmitted',
      files: { reportUrl: '/report-v2' },
    });
    const secondResponse = makeResponse();
    await evaluationController.submitEvaluation({
      body: {
        projectId: project._id,
        phase: 'abstract',
        submissionVersion: 2,
        scores: [
          { criteriaName: 'Novelty & Scope', maxMarks: 10, scoredMarks: 9 },
          { criteriaName: 'Literature Survey', maxMarks: 10, scoredMarks: 8 },
          { criteriaName: 'SRS Document Quality', maxMarks: 10, scoredMarks: 10 },
        ],
        feedback: 'Version two feedback',
        isPublished: false,
      },
      user: { id: 'faculty-1', role: 'faculty' },
    }, secondResponse, (error) => { throw error; });
    assert.equal(secondResponse.body.evaluation.submissionVersion, 2);
    assert.equal(project.stageSubmissions[0].rubricEvaluation.feedback, 'Version one feedback');
    assert.equal(project.stageSubmissions[1].rubricEvaluation.feedback, 'Version two feedback');
    assert.equal(project.status, 'faculty_accepted');
  } finally {
    Project.findById = originalProjectFindById;
    Evaluation.findOne = originalEvaluationFindOne;
    Evaluation.create = originalEvaluationCreate;
  }
});

test('legacy FINAL submissions with all three existing files remain in the formal queue as version zero', async () => {
  const legacyProject = {
    _id: 'legacy-final-project',
    title: 'Legacy final submission',
    status: 'submitted',
    assignedFaculty: 'faculty-1',
    submittedAt: new Date(),
    stageSubmissions: [],
    files: { reportUrl: '/report', pptUrl: '/slides', codeZipUrl: '/source' },
  };
  const originalFind = Project.find;
  Project.find = () => ({
    populate() { return this; },
    sort() { return this; },
    limit: async () => [legacyProject],
  });
  try {
    const response = makeResponse();
    await projectController.getFacultyReviewProjects(
      { user: { id: 'faculty-1', role: 'faculty' } }, response, (error) => { throw error; },
    );
    assert.equal(response.body.submissions.length, 1);
    assert.equal(response.body.submissions[0].phase, 'final');
    assert.equal(response.body.submissions[0].version, 0);
    assert.equal(response.body.submissions[0].legacy, true);
  } finally {
    Project.find = originalFind;
  }
});

test('legacy project documents receive safe stage defaults without rewriting stored project data', () => {
  const legacyProject = new Project({
    title: 'Existing project record',
    description: 'A legacy project with the original fields.',
    leader: '650000000000000000000001',
    status: 'submitted',
    files: { reportUrl: '/legacy-report', pptUrl: '/legacy-slides', codeZipUrl: '/legacy-source' },
  });
  assert.deepEqual(legacyProject.stageSubmissions, []);
  assert.equal(legacyProject.stageWorkflowEnabled, false);
  assert.equal(legacyProject.files.reportUrl, '/legacy-report');
});

test('stage-enabled projects cannot bypass Review 3 through the legacy final-submit route', async () => {
  const project = {
    _id: 'stage-final-gate-project',
    leader: 'leader-1',
    teamMembers: ['leader-1'],
    status: 'faculty_accepted',
    stageWorkflowEnabled: true,
    stageSubmissions: [],
    files: { reportUrl: '/report', pptUrl: '/slides', codeZipUrl: '/source' },
    save: async () => assert.fail('missing phase approvals must block FINAL submission'),
  };
  const originalFindById = Project.findById;
  Project.findById = async () => project;
  try {
    let receivedError;
    await projectController.submitProject(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      makeResponse(),
      (error) => { receivedError = error; },
    );
    assert.equal(receivedError.statusCode, 400);
    assert.match(receivedError.message, /phase-specific review workflow/);
    assert.equal(project.status, 'faculty_accepted');
  } finally {
    Project.findById = originalFindById;
  }
});

test('Review 3 requires Review 2 approval and a valid deployment URL', async () => {
  const project = {
    _id: 'stage-final-review-project',
    leader: 'leader-1',
    teamMembers: ['leader-1'],
    batch: '2023-2027',
    assignedFaculty: 'faculty-1',
    status: 'faculty_accepted',
    stageWorkflowEnabled: true,
    stageSubmissions: [
      { phase: 'abstract', version: 1, status: 'approved', files: { reportUrl: '/abstract-report', pptUrl: '/abstract-slides' } },
      { phase: 'midterm', version: 1, status: 'submitted', files: { reportUrl: '/design-report', pptUrl: '/design-slides' } },
      { phase: 'final', version: 1, status: 'draft', files: { reportUrl: '/final-report', pptUrl: '/final-slides', codeZipUrl: '/final-source' } },
    ],
    files: {},
    save: async function () { return this; },
  };
  const deadline = makeDeadline();
  deadline.phase = 'final';
  deadline.batch = 'Batch 2027';

  await withModels(project, deadline, async () => {
    let unauthorizedDraftError;
    await projectController.saveStageDraft(
      { params: { id: project._id, phase: 'final' }, body: { deploymentUrl: 'https://demo.example' }, user: { id: 'other-student', role: 'student' } },
      makeResponse(),
      (error) => { unauthorizedDraftError = error; },
    );
    assert.equal(unauthorizedDraftError.statusCode, 403);

    let uploadPrerequisiteError;
    await projectController.uploadStageFile(
      {
        params: { id: project._id, phase: 'final' },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: {
          path: path.join(uploadDirectory, 'blocked-final-stage-upload.pdf'),
          filename: 'blocked-final-stage-upload.pdf',
          originalname: 'final.pdf',
          mimetype: 'application/pdf',
          size: 100,
        },
      },
      makeResponse(),
      (error) => { uploadPrerequisiteError = error; },
    );
    assert.equal(uploadPrerequisiteError.statusCode, 400);
    assert.match(uploadPrerequisiteError.message, /Midterm stage approval/);

    let prerequisiteError;
    await projectController.submitStage(
      { params: { id: project._id, phase: 'final' }, body: { deploymentUrl: 'https://demo.example' }, user: { id: 'leader-1', role: 'student' } },
      makeResponse(),
      (error) => { prerequisiteError = error; },
    );
    assert.equal(prerequisiteError.statusCode, 400);
    assert.match(prerequisiteError.message, /Midterm stage approval/);

    project.stageSubmissions[1].status = 'approved';
    const draftResponse = makeResponse();
    await projectController.saveStageDraft(
      { params: { id: project._id, phase: 'final' }, body: { deploymentUrl: 'https://demo.example' }, user: { id: 'leader-1', role: 'student' } },
      draftResponse,
      (error) => { throw error; },
    );
    assert.equal(draftResponse.body.submission.deploymentUrl, 'https://demo.example');
    assert.ok(draftResponse.body.submission.draftSavedAt);

    let urlError;
    await projectController.submitStage(
      { params: { id: project._id, phase: 'final' }, body: { deploymentUrl: 'javascript:alert(1)' }, user: { id: 'leader-1', role: 'student' } },
      makeResponse(),
      (error) => { urlError = error; },
    );
    assert.equal(urlError.statusCode, 400);
    assert.match(urlError.message, /valid HTTP or HTTPS/);

    const response = makeResponse();
    await projectController.submitStage(
      { params: { id: project._id, phase: 'final' }, body: { deploymentUrl: 'https://demo.example' }, user: { id: 'leader-1', role: 'student' } },
      response,
      (error) => { throw error; },
    );
    assert.equal(response.body.submission.status, 'submitted');
    assert.equal(response.body.submission.deploymentUrl, 'https://demo.example');
    assert.deepEqual(withModels.lastDeadlineQuery, {
      batch: { $in: ['2023-2027', '2027', 'Batch 2027'] },
      isActive: true,
      $or: [{ phase: 'final' }, { phase: { $exists: false } }],
    });
    assert.equal(project.status, 'faculty_accepted');

    response.body.submission.rubricEvaluation = { isPublished: true, totalScore: 50 };
    const approvalResponse = makeResponse();
    await projectController.reviewStageSubmission({
      params: { id: project._id, phase: 'final', version: '1' },
      body: { decision: 'approved', feedback: 'Final review approved.' },
      user: { id: 'faculty-1', role: 'faculty' },
    }, approvalResponse, (error) => { throw error; });
    assert.equal(approvalResponse.body.submission.status, 'approved');
    assert.equal(project.status, 'evaluated');
  });
});

test('final-stage revision URL changes require an explicit faculty grant', async () => {
  const project = {
    _id: 'final-revision-url-project',
    leader: 'leader-1',
    teamMembers: ['leader-1'],
    batch: 'Batch 2026',
    status: 'faculty_accepted',
    stageWorkflowEnabled: true,
    stageSubmissions: [
      { phase: 'abstract', version: 1, status: 'approved', files: {} },
      { phase: 'midterm', version: 1, status: 'approved', files: {} },
      {
        phase: 'final', version: 1, status: 'changes_requested', revisionAccessGranted: true,
        revisionFileTypes: ['report'], deploymentUrl: 'https://original.example',
        files: { reportUrl: '/report-v1', pptUrl: '/slides-v1', codeZipUrl: '/source-v1' },
      },
      {
        phase: 'final', version: 2, status: 'draft', resubmissionOfVersion: 1,
        deploymentUrl: 'https://original.example',
        files: { reportUrl: '/report-v2', pptUrl: '/slides-v2', codeZipUrl: '/source-v2' },
      },
    ],
    save: async () => assert.fail('an ungranted deployment URL change must not be saved'),
  };
  const deadline = makeDeadline();
  deadline.phase = 'final';

  await withModels(project, deadline, async () => {
    let saveError;
    await projectController.saveStageDraft(
      { params: { id: project._id, phase: 'final' }, body: { deploymentUrl: 'https://changed.example' }, user: { id: 'leader-1', role: 'student' } },
      makeResponse(),
      (error) => { saveError = error; },
    );
    assert.equal(saveError.statusCode, 403);
    assert.match(saveError.message, /did not authorize a deployment URL revision/);

    let submitError;
    await projectController.submitStage(
      { params: { id: project._id, phase: 'final' }, body: { deploymentUrl: 'https://changed.example' }, user: { id: 'leader-1', role: 'student' } },
      makeResponse(),
      (error) => { submitError = error; },
    );
    assert.equal(submitError.statusCode, 403);
    assert.match(submitError.message, /did not authorize a deployment URL revision/);
  });
});

test('student deadline lookup uses the project cohort and rejects nonmembers', async () => {
  const project = {
    batch: '2023-2027',
    cohortId: 'IT-2023-E',
    teamMembers: ['student-1'],
    deadline: null,
  };
  const deadlines = [
    { batch: 'Batch 2027', phase: 'abstract', isActive: true },
    { batch: 'Batch 2027', phase: 'midterm', isActive: true },
    { batch: 'Batch 2027', phase: 'final', isActive: true },
  ];
  let deadlineQuery;
  Project.findById = () => ({ populate: async () => project });
  Deadline.find = (query) => {
    deadlineQuery = query;
    return { sort: async () => deadlines };
  };

  try {
    const response = makeResponse();
    await projectController.getStudentDeadlines({
      query: { projectId: '650000000000000000000001' },
      user: { id: 'student-1', role: 'student', batch: 'Other Batch' },
    }, response, (error) => { throw error; });
    assert.deepEqual(deadlineQuery, { isActive: true, batch: { $in: ['2023-2027', '2027', 'Batch 2027', 'IT-2023-E'] } });
    assert.deepEqual(response.body.deadlines, deadlines);

    Project.findById = () => ({ populate: async () => project });
    Deadline.find = () => assert.fail('nonmembers must not query another project cohort deadline');
    let accessError;
    await projectController.getStudentDeadlines({
      query: { projectId: '650000000000000000000001' },
      user: { id: 'student-2', role: 'student', batch: 'Batch 2026' },
    }, makeResponse(), (error) => { accessError = error; });
    assert.equal(accessError.statusCode, 403);
  } finally {
    Project.findById = originalProjectFindById;
    Deadline.find = originalDeadlineFind;
  }
});

test('project serialization removes a legacy self-match and recalculates its score', async () => {
  const project = {
    _id: 'self-match-project',
    title: 'Current project',
    teamMembers: ['student-1'],
    uniquenessCheck: {
      status: 'completed',
      overallScore: 77,
      matches: [
        { projectId: 'self-match-project', title: 'Current project', similarityScore: 77 },
        { projectId: 'other-project', title: 'Other project', similarityScore: 34 },
      ],
    },
  };
  Project.countDocuments = async () => 1;
  Project.find = () => ({
    populate() { return this; },
    sort() { return this; },
    skip() { return this; },
    limit: async () => [project],
  });
  try {
    const response = makeResponse();
    await projectController.getProjects({
      user: { id: 'student-1', role: 'student' },
      query: {},
    }, response, (error) => { throw error; });
    const check = response.body.projects[0].uniquenessCheck;
    assert.deepEqual(check.matches.map((match) => String(match.projectId)), ['other-project']);
    assert.equal(check.overallScore, 34);
    assert.match(check.scoreMethod, /self-match removed/i);
    assert.equal(project.uniquenessCheck.matches.length, 2);
  } finally {
    Project.find = originalProjectFind;
    Project.countDocuments = originalProjectCountDocuments;
  }
});