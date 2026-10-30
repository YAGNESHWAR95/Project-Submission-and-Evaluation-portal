const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const projectController = require('../src/controllers/projectController');
const Project = require('../src/models/Project');
const Deadline = require('../src/models/Deadline');

const uploadDirectory = path.resolve(__dirname, '../uploads');
const originalFindById = Project.findById;
const originalFind = Project.find;
const originalDeadlineFindById = Deadline.findById;
const originalSemanticSetting = process.env.ENABLE_SEMANTIC_SIMILARITY;

const createPdf = (text) => {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
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

const withPatchedProject = async (project, run) => {
  Project.findById = async () => project;
  try {
    await run();
  } finally {
    Project.findById = originalFindById;
    Project.find = originalFind;
    Deadline.findById = originalDeadlineFindById;
    if (originalSemanticSetting === undefined) delete process.env.ENABLE_SEMANTIC_SIMILARITY;
    else process.env.ENABLE_SEMANTIC_SIMILARITY = originalSemanticSetting;
  }
};

test('failed replacement retains the previous file and removes the new upload', async () => {
  const suffix = crypto.randomUUID();
  const oldName = `old-${suffix}.pdf`;
  const newName = `new-${suffix}.pdf`;
  const oldPath = path.join(uploadDirectory, oldName);
  const newPath = path.join(uploadDirectory, newName);
  fs.writeFileSync(oldPath, 'previous valid file');
  fs.writeFileSync(newPath, createPdf('Report replacement text'));
  const project = {
    _id: `project-${suffix}`,
    leader: 'leader-1',
    status: 'faculty_accepted',
    files: { reportUrl: `http://localhost:5000/uploads/${oldName}`, reportName: 'old.pdf' },
    save: async () => { throw new Error('simulated database write failure'); },
  };
  Deadline.findById = async () => ({
    isActive: true,
    submissionStartDate: new Date(Date.now() - 86400000),
    submissionEndDate: new Date(Date.now() + 86400000),
  });

  try {
    await withPatchedProject(project, async () => {
      let receivedError;
      await projectController.uploadProjectFile({
        params: { id: project._id },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: { path: newPath, filename: newName, originalname: 'report.pdf', mimetype: 'application/pdf', size: fs.statSync(newPath).size },
      }, { status() { return this; }, json() {} }, (error) => { receivedError = error; });
      assert.match(receivedError.message, /database write failure/);
    });
    assert.equal(fs.existsSync(oldPath), true);
    assert.equal(fs.existsSync(newPath), false);
  } finally {
    fs.rmSync(oldPath, { force: true });
    fs.rmSync(newPath, { force: true });
  }
});

test('project document downloads reject unrelated students and unassigned faculty', async () => {
  const project = {
    _id: 'project-private-file',
    leader: 'leader-1',
    teamMembers: ['leader-1', 'member-1'],
    assignedFaculty: 'faculty-1',
    files: { reportUrl: '/api/projects/project-private-file/files/report/download' },
  };

  await withPatchedProject(project, async () => {
    for (const user of [
      { id: 'other-student', role: 'student' },
      { id: 'other-faculty', role: 'faculty' },
    ]) {
      let receivedError;
      await projectController.downloadProjectFile({
        params: { id: project._id, purpose: 'report' },
        user,
      }, { setHeader() {}, download() {} }, (error) => { receivedError = error; });
      assert.equal(receivedError.statusCode, 403);
    }
  });
});

test('report originality compares portal proposals and reports without inventing semantic scores', async () => {
  await withPatchedProject(null, async () => {
  const reportText = `
    The project develops an accessible learning support platform for students and instructors.
    Course activity and assessment history are analyzed to identify learners who may need support.
    The platform presents understandable progress summaries and learning recommendations.\f
    The project develops an accessible learning support platform for students and instructors.
    Course activity and assessment history are analyzed to identify learners who may need support.
  `;
  const project = {
    _id: 'project-report-analysis',
    uniquenessCheck: { status: 'completed', overallScore: 12 },
    files: {
      reportText,
      reportTextStatus: 'available',
      reportHash: 'report-hash-1',
      reportAnalysisVersion: 1,
      reportPageCount: 2,
      reportPagesAnalyzed: 2,
    },
  };
  Project.find = async () => [{
    _id: 'project-prior-analysis',
    title: 'Learning Support Platform',
    domain: 'Education technology',
    abstract: 'The project develops an accessible learning support platform for students and instructors.',
    problemStatement: 'Course activity and assessment history identify learners who may need support.',
    objectives: 'Present progress summaries and learning recommendations.',
    files: {
      reportTextStatus: 'available',
      reportText: 'The project develops an accessible learning support platform for students and instructors. Course activity and assessment history are analyzed to identify learners who may need support.',
    },
  }];
  process.env.ENABLE_SEMANTIC_SIMILARITY = 'false';

  const result = await projectController.buildReportOriginalityResult(project);
  assert.equal(result.status, 'completed');
  assert.ok(result.overallScore > 0);
  assert.equal(result.comparisonCoverage.pagesAnalyzed, 2);
  assert.equal(result.comparisonCoverage.proposalSourcesCompared, 1);
  assert.equal(result.comparisonCoverage.priorReportSourcesCompared, 1);
  assert.ok(result.matches[0].matchingSections.length > 0);
  assert.equal(result.semanticStatus, 'unavailable');
  assert.equal(result.matches[0].semanticSimilarity, null);
  assert.equal(project.uniquenessCheck.overallScore, 12);
  });
});

test('report originality does not assign a score to scanned or unreadable text', async () => {
  await withPatchedProject(null, async () => {
    const result = await projectController.buildReportOriginalityResult({
      files: { reportText: '', reportTextStatus: 'needs_ocr', reportPageCount: 4, reportPagesAnalyzed: 4 },
    });
    assert.equal(result.status, 'needs_ocr');
    assert.equal(result.overallScore, null);
    assert.equal(result.semanticStatus, 'not_attempted');
    assert.equal(result.comparisonCoverage.pagesAvailable, 4);
  });
});

test('successful revision replacement retains the prior snapshotted document', async () => {
  const suffix = crypto.randomUUID();
  const oldName = `revision-old-${suffix}.pdf`;
  const newName = `revision-new-${suffix}.pdf`;
  const oldPath = path.join(uploadDirectory, oldName);
  const newPath = path.join(uploadDirectory, newName);
  fs.writeFileSync(oldPath, 'prior revision file');
  fs.writeFileSync(newPath, createPdf('Updated report contains enough meaningful text for analysis.'));
  const previousFiles = {
    reportUrl: `/api/projects/project-${suffix}/files/report/download`,
    reportStorageName: oldName,
    reportName: 'prior-report.pdf',
  };
  const project = {
    _id: `project-${suffix}`,
    leader: 'leader-1',
    status: 'revision_required',
    revisionRequest: {
      active: true,
      status: 'granted',
      fileTypes: ['report'],
      snapshotBeforeRevision: { files: previousFiles },
    },
    files: { ...previousFiles },
    save: async function () { return this; },
  };
  Deadline.findById = async () => ({
    isActive: true,
    submissionStartDate: new Date(Date.now() - 86400000),
    submissionEndDate: new Date(Date.now() + 86400000),
  });

  try {
    await withPatchedProject(project, async () => {
      let responseBody;
      await projectController.uploadProjectFile({
        params: { id: project._id },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: { path: newPath, filename: newName, originalname: 'report.pdf', mimetype: 'application/pdf', size: fs.statSync(newPath).size },
      }, { status() { return this; }, json(body) { responseBody = body; return this; } }, (error) => { throw error; });
      assert.equal(responseBody.status, 'success');
    });
    assert.equal(fs.existsSync(oldPath), true);
    assert.equal(fs.existsSync(newPath), true);
  } finally {
    fs.rmSync(oldPath, { force: true });
    fs.rmSync(newPath, { force: true });
  }
});

test('authorized project team members can download a prior revision file by version', async () => {
  const suffix = crypto.randomUUID();
  const oldName = `download-version-${suffix}.pdf`;
  const oldPath = path.join(uploadDirectory, oldName);
  fs.writeFileSync(oldPath, 'version one document');
  const project = {
    _id: `project-${suffix}`,
    leader: 'leader-1',
    teamMembers: ['leader-1', 'member-1'],
    assignedFaculty: 'faculty-1',
    files: {},
    revisionHistory: [{
      versionNumber: 1,
      snapshot: { files: { reportStorageName: oldName, reportName: 'version-one.pdf' } },
    }],
  };

  try {
    await withPatchedProject(project, async () => {
      let download;
      await projectController.downloadProjectFile({
        params: { id: project._id, purpose: 'report' },
        query: { versionNumber: '1' },
        user: { id: 'member-1', role: 'student' },
      }, {
        setHeader() {},
        download(filePath, filename) { download = { filePath, filename }; },
      }, (error) => { throw error; });
      assert.equal(download.filePath, fs.realpathSync(oldPath));
      assert.equal(download.filename, 'version-one.pdf');
    });
  } finally {
    fs.rmSync(oldPath, { force: true });
  }
});

test('approved projects cannot replace deliverables after the submission deadline', async () => {
  const suffix = crypto.randomUUID();
  const filename = `late-upload-${suffix}.pdf`;
  const filePath = path.join(uploadDirectory, filename);
  fs.writeFileSync(filePath, createPdf('A valid report that is submitted after the deadline.'));
  const project = {
    _id: `project-${suffix}`,
    leader: 'leader-1',
    status: 'faculty_accepted',
    deadline: 'deadline-expired-upload',
    files: {},
    save: async () => { throw new Error('expired upload must not persist'); },
  };
  Deadline.findById = async () => ({
    isActive: true,
    submissionStartDate: new Date(Date.now() - 10 * 86400000),
    submissionEndDate: new Date(Date.now() - 86400000),
  });

  try {
    await withPatchedProject(project, async () => {
      let receivedError;
      await projectController.uploadProjectFile({
        params: { id: project._id },
        body: { purpose: 'report' },
        user: { id: 'leader-1', role: 'student' },
        file: { path: filePath, filename, originalname: 'late.pdf', mimetype: 'application/pdf', size: fs.statSync(filePath).size },
      }, { status() { return this; }, json() {} }, (error) => { receivedError = error; });
      assert.equal(receivedError.statusCode, 400);
      assert.match(receivedError.message, /deadline has passed/);
    });
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('report originality identifies the phase and version of a prior stage report source', async () => {
  const currentText = 'Students need an accessible learning support system with course progress analysis and clear instructor guidance for different learning needs across every class.';
  let result;
  await withPatchedProject(null, async () => {
    Project.find = async () => [{
      _id: 'prior-stage-project',
      title: 'Prior learning system',
      status: 'evaluated',
      stageSubmissions: [{
        phase: 'midterm',
        version: 3,
        status: 'approved',
        files: {
          reportTextStatus: 'available',
          reportText: 'Students need an accessible learning support system with course progress analysis and clear instructor guidance for different learning needs across every class.',
        },
      }],
    }];
    process.env.ENABLE_SEMANTIC_SIMILARITY = 'false';
    result = await projectController.buildReportOriginalityResult({
      _id: 'current-stage-project',
      files: {
        reportText: currentText,
        reportTextStatus: 'available',
        reportHash: 'current-report-hash',
        reportAnalysisVersion: 2,
        reportPageCount: 1,
        reportPagesAnalyzed: 1,
      },
    });
  });
  assert.equal(result.matches[0].sourcePhase, 'midterm');
  assert.equal(result.matches[0].sourceVersion, 3);
  assert.ok(result.matches[0].matchingSections.length > 0);
  assert.equal(result.matches[0].semanticStatus, 'unavailable');
  assert.equal(result.matches[0].semanticSimilarity, null);
});