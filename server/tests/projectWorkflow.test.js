const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const projectController = require('../src/controllers/projectController');
const invitationController = require('../src/controllers/invitationController');
const Project = require('../src/models/Project');
const Deadline = require('../src/models/Deadline');
const User = require('../src/models/User');
const TeamInvitation = require('../src/models/TeamInvitation');
const ProjectMember = require('../src/models/ProjectMember');
const Notification = require('../src/models/Notification');
const ProjectMessage = require('../src/models/ProjectMessage');
const PlagiarismResult = require('../src/models/PlagiarismResult');
const { comparisonFields } = require('../src/config/uniquenessConfig');
const { EMBEDDING_CACHE, getEmbeddingCacheKey } = require('../src/services/semanticSimilarityService');

const originalProjectFindById = Project.findById;
const originalProjectCreate = Project.create;
const originalProjectFind = Project.find;
const originalProjectFindOne = Project.findOne;
const originalProjectFindOneAndUpdate = Project.findOneAndUpdate;
const originalProjectCountDocuments = Project.countDocuments;
const originalUserFindById = User.findById;
const originalUserFindOne = User.findOne;
const originalTeamInvitationFindOne = TeamInvitation.findOne;
const originalTeamInvitationFindOneAndUpdate = TeamInvitation.findOneAndUpdate;
const originalProjectMemberFindOne = ProjectMember.findOne;
const originalProjectMemberCreate = ProjectMember.create;
const originalNotificationCreate = Notification.create;
const originalProjectMessageFind = ProjectMessage.find;
const originalProjectMessageCreate = ProjectMessage.create;
const originalDeadlineFindById = Deadline.findById;
const originalPlagiarismResultCreate = PlagiarismResult.create;

async function withPatchedModels(run) {
  try {
    await run();
  } finally {
    Project.findById = originalProjectFindById;
    Project.create = originalProjectCreate;
    Project.find = originalProjectFind;
    Project.findOne = originalProjectFindOne;
    Project.findOneAndUpdate = originalProjectFindOneAndUpdate;
    Project.countDocuments = originalProjectCountDocuments;
    User.findById = originalUserFindById;
    User.findOne = originalUserFindOne;
    TeamInvitation.findOne = originalTeamInvitationFindOne;
    TeamInvitation.findOneAndUpdate = originalTeamInvitationFindOneAndUpdate;
    ProjectMember.findOne = originalProjectMemberFindOne;
    ProjectMember.create = originalProjectMemberCreate;
    Notification.create = originalNotificationCreate;
    ProjectMessage.find = originalProjectMessageFind;
    ProjectMessage.create = originalProjectMessageCreate;
    Deadline.findById = originalDeadlineFindById;
    PlagiarismResult.create = originalPlagiarismResultCreate;
  }
}

const withEnvironment = async (values, run) => {
  const originalValues = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    await run();
  } finally {
    Object.entries(originalValues).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
};

const makeSimilarityProject = (id, overrides = {}) => ({
  _id: id,
  leader: `leader-${id}`,
  teamMembers: [`leader-${id}`],
  title: 'Student academic performance prediction platform',
  domain: 'Education analytics',
  abstract: 'Analyze student assessment records to identify learners who may need timely support.',
  problemStatement: 'Educators need early insight into academic difficulties across a course.',
  objectives: 'Predict performance trends and guide students toward relevant learning resources.',
  methodology: 'Evaluate supervised learning models against anonymized academic records.',
  technologies: 'Python React MongoDB',
  expectedOutcome: 'Provide interpretable performance forecasts for students and faculty.',
  description: 'A platform for academic trend analysis and student support.',
  status: 'proposal_created',
  uniquenessCheck: { status: 'not_checked' },
  save: async function () { return this; },
  ...overrides,
});

const runSimilarityCheck = async (project, candidates) => {
  Project.findById = async () => project;
  Project.find = async () => candidates;
  let responseBody;
  await projectController.runUniquenessCheck(
    { params: { id: project._id }, user: { id: String(project.leader), role: 'student' } },
    { status() { return this; }, json(body) { responseBody = body; return this; } },
    (error) => { throw error; },
  );
  return responseBody.result;
};

test('authorized team member can send and read project messages', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-msg-1',
      leader: 'leader-1',
      teamMembers: ['leader-1', 'member-2'],
      assignedFaculty: 'faculty-1',
      title: 'Message Project',
    };
    Project.findById = async () => project;
    ProjectMessage.find = async () => [{
      _id: 'message-1',
      sender: { _id: 'leader-1', name: 'Team Leader', role: 'student' },
      content: 'Status update',
      createdAt: new Date(),
    }];
    ProjectMessage.create = async (payload) => ({ _id: 'message-1', ...payload });
    Notification.create = async (payload) => payload;

    let readResponse;
    await projectController.getProjectMessages(
      { params: { id: 'project-msg-1' }, user: { id: 'member-2', role: 'student' } },
      { status() { return this; }, json(body) { readResponse = body; return this; } },
      (err) => { throw err; }
    );
    assert.equal(readResponse.status, 'success');
    assert.equal(readResponse.messages.length, 1);

    let sendResponse;
    await projectController.createProjectMessage(
      { params: { id: 'project-msg-1' }, body: { content: 'Need review updates' }, user: { id: 'member-2', role: 'student', name: 'Student Two' } },
      { status() { return this; }, json(body) { sendResponse = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(sendResponse.status, 'success');
    assert.equal(sendResponse.message.content, 'Need review updates');
  });
});

test('revision editor access is available only for an active granted request', async () => {
  const { getRevisionPermissions, hasActiveRevisionAccess, hasRevisionPermissionItems } = await import(pathToFileURL(
    require('node:path').resolve(__dirname, '../../client/src/utils/revisionAccess.js')
  ).href);

  assert.equal(hasActiveRevisionAccess({ active: true, status: 'granted' }), true);
  assert.equal(hasActiveRevisionAccess({ active: false, status: 'granted' }), false);
  assert.equal(hasActiveRevisionAccess({ active: true, status: 'pending' }), false);
  assert.equal(hasActiveRevisionAccess(null), false);
  assert.deepEqual(getRevisionPermissions({ editableFields: ['abstract', 'invalid'], fileTypes: ['report', 'exe'] }), {
    fields: ['abstract'],
    fileTypes: ['report'],
  });
  assert.equal(hasRevisionPermissionItems({ editableFields: [], fileTypes: ['unknown'] }), false);
});

test('authorized student project list returns active revision grant details', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-active-grant',
      revisionRequest: {
        active: true,
        status: 'granted',
        reason: 'Please update the methodology.',
        editableFields: ['methodology'],
        fileTypes: ['report'],
        dueDate: new Date('2026-12-01T00:00:00.000Z'),
      },
    };
    let projectFilter;
    const query = {
      populate() { return this; },
      sort() { return this; },
      skip() { return this; },
      limit: async () => [project],
    };
    Project.countDocuments = async () => 1;
    Project.find = (filter) => {
      projectFilter = filter;
      return query;
    };

    let response;
    await projectController.getProjects(
      { user: { id: 'leader-1', role: 'student' }, query: {} },
      { status() { return this; }, json(body) { response = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(projectFilter.teamMembers, 'leader-1');
    assert.equal(response.projects[0].revisionRequest.active, true);
    assert.deepEqual(response.projects[0].revisionRequest.editableFields, ['methodology']);
    assert.deepEqual(response.projects[0].revisionRequest.fileTypes, ['report']);
  });
});

test('unauthorized student cannot access another project discussion', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-msg-2',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      title: 'Other Project',
    };
    Project.findById = async () => project;

    let error;
    await projectController.getProjectMessages(
      { params: { id: 'project-msg-2' }, user: { id: 'student-3', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.ok(error);
    assert.equal(error.statusCode, 403);
  });
});

test('assigned faculty can request a revision and grant access', async () => {
  await withPatchedModels(async () => {
    Deadline.findById = async () => ({
      isActive: true,
      submissionStartDate: new Date(Date.now() - 86400000),
      submissionEndDate: new Date(Date.now() + 86400000),
    });
    const project = {
      _id: 'project-revision-1',
      leader: 'leader-1',
      teamMembers: ['leader-1', 'member-2'],
      assignedFaculty: 'faculty-1',
      status: 'submitted',
      title: 'Revision Project',
      save: async function () { return this; },
      revisionRequest: null,
    };
    Project.findById = async () => project;
    Notification.create = async (payload) => payload;

    let requestResponse;
    await projectController.requestRevision(
      { params: { id: 'project-revision-1' }, body: { reason: 'Please improve methodology', editableFields: ['methodology'], fileTypes: ['report'], revisionDeadline: '2026-12-01T00:00:00.000Z' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { requestResponse = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(requestResponse.status, 'success');
    assert.equal(project.status, 'revision_required');
    assert.equal(project.revisionRequest.active, false);
    assert.equal(project.revisionRequest.snapshotBeforeRevision.title, 'Revision Project');
    assert.deepEqual(requestResponse.revisionRequest.editableFields, ['methodology']);
    assert.deepEqual(requestResponse.revisionRequest.fileTypes, ['report']);

    let grantResponse;
    await projectController.grantRevisionAccess(
      { params: { id: 'project-revision-1' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { grantResponse = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(grantResponse.status, 'success');
    assert.equal(project.revisionRequest.active, true);
    assert.equal(project.revisionRequest.status, 'granted');
    assert.deepEqual(grantResponse.revisionRequest.editableFields, ['methodology']);
    assert.deepEqual(grantResponse.revisionRequest.fileTypes, ['report']);
  });
});

test('revision request rejects missing permissions instead of defaulting to all fields', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-revision-empty-request',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      status: 'submitted',
      title: 'No Permission Project',
      save: async function () { return this; },
    };
    Project.findById = async () => project;

    let error;
    await projectController.requestRevision(
      { params: { id: project._id }, body: { reason: 'Update requested' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.equal(error?.statusCode, 400);
    assert.equal(project.revisionRequest, undefined);
  });
});

test('legacy pending revision with empty permissions cannot be granted', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-revision-empty-grant',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      status: 'revision_required',
      revisionRequest: { active: false, status: 'pending', editableFields: [], fileTypes: [] },
      save: async function () { return this; },
    };
    Project.findById = async () => project;

    let error;
    await projectController.grantRevisionAccess(
      { params: { id: project._id }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.equal(error?.statusCode, 400);
    assert.equal(project.revisionRequest.active, false);
    assert.equal(project.revisionRequest.status, 'pending');
  });
});

test('legacy active revision with empty permissions cannot be resubmitted', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-revision-empty-resubmit',
      leader: 'leader-1',
      assignedFaculty: 'faculty-1',
      status: 'revision_required',
      revisionRequest: { active: true, status: 'granted', editableFields: [], fileTypes: [] },
      revisionHistory: [],
      save: async function () { return this; },
    };
    Project.findById = async () => project;

    let error;
    await projectController.resubmitProject(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.equal(error?.statusCode, 400);
    assert.equal(project.revisionRequest.active, true);
    assert.equal(project.revisionHistory.length, 0);
  });
});

test('unassigned faculty cannot request revisions', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-revision-2',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-9',
      status: 'submitted',
      title: 'Other Revision Project',
      save: async function () { return this; },
      revisionRequest: null,
    };
    Project.findById = async () => project;

    let error;
    await projectController.requestRevision(
      { params: { id: 'project-revision-2' }, body: { reason: 'Please improve methodology', editableFields: ['methodology'] }, user: { id: 'faculty-2', role: 'faculty' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.ok(error);
    assert.equal(error.statusCode, 403);
  });
});

test('student edits are rejected after submission without revision access', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-lock-1',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      status: 'submitted',
      title: 'Locked Project',
      abstract: 'Original',
      description: 'Original',
      problemStatement: 'Original',
      objectives: 'Original',
      methodology: 'Original',
      technologies: 'React',
      expectedOutcome: 'Original',
      save: async function () { return this; },
      revisionRequest: null,
    };
    Project.findById = async () => project;

    let error;
    await projectController.updateProject(
      { params: { id: 'project-lock-1' }, body: { title: 'Attempted change' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.ok(error);
    assert.equal(error.statusCode, 400);
    assert.equal(project.title, 'Locked Project');
  });
});

test('student edits are allowed only for fields granted by an active revision request', async () => {
  await withPatchedModels(async () => {
    Deadline.findById = async () => ({
      isActive: true,
      submissionStartDate: new Date(Date.now() - 86400000),
      submissionEndDate: new Date(Date.now() + 86400000),
    });
    const project = {
      _id: 'project-lock-2',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      status: 'submitted',
      title: 'Editable Project',
      abstract: 'Old abstract',
      description: 'Old description',
      problemStatement: 'Old problem',
      objectives: 'Old objectives',
      methodology: 'Old methodology',
      technologies: 'React',
      expectedOutcome: 'Old outcome',
      save: async function () { return this; },
      revisionRequest: {
        active: true,
        status: 'granted',
        editableFields: ['methodology'],
      },
    };
    Project.findById = async () => project;

    let error;
    await projectController.updateProject(
      { params: { id: 'project-lock-2' }, body: { methodology: 'Updated methodology', title: 'Attempted title change' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.equal(error?.statusCode, 403);
    assert.equal(project.methodology, 'Old methodology');
    assert.equal(project.title, 'Editable Project');

    let response;
    await projectController.updateProject(
      { params: { id: 'project-lock-2' }, body: { methodology: 'Updated methodology' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json(body) { response = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(response.status, 'success');
    assert.equal(project.methodology, 'Updated methodology');
    assert.equal(project.title, 'Editable Project');
  });
});

test('student cannot upload a file type outside the active revision grant', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-file-lock',
      leader: 'leader-1',
      status: 'revision_required',
      revisionRequest: { active: true, status: 'granted', editableFields: ['methodology'], fileTypes: [] },
    };
    Project.findById = async () => project;

    let error;
    await projectController.uploadProjectFile(
      { params: { id: project._id }, body: { purpose: 'report' }, file: { originalname: 'report.pdf' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.equal(error?.statusCode, 400);
  });
});

test('revision access closes after resubmission and previous versions remain', async () => {
  await withPatchedModels(async () => {
    Deadline.findById = async () => ({
      isActive: true,
      submissionStartDate: new Date(Date.now() - 86400000),
      submissionEndDate: new Date(Date.now() + 86400000),
    });
    const project = {
      _id: 'project-lock-3',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      status: 'revision_required',
      title: 'Versioned Project',
      abstract: 'Original abstract',
      description: 'Original description',
      problemStatement: 'Original problem',
      objectives: 'Original objectives',
      methodology: 'Original methodology',
      technologies: 'React',
      expectedOutcome: 'Original outcome',
      deadline: 'deadline-revision-1',
      files: {
        reportUrl: '/api/projects/project-lock-3/files/report/download',
        pptUrl: '/api/projects/project-lock-3/files/presentation/download',
        codeZipUrl: '/api/projects/project-lock-3/files/source/download',
      },
      submittedAt: new Date('2026-01-01'),
      save: async function () { return this; },
      revisionRequest: {
        active: true,
        status: 'granted',
        editableFields: ['methodology'],
      },
      revisionHistory: [],
    };
    Project.findById = async () => project;
    const createdNotifications = [];
    Notification.create = async (payload) => {
      createdNotifications.push(payload);
      return {};
    };

    let response;
    await projectController.resubmitProject(
      { params: { id: 'project-lock-3' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json(body) { response = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(response.status, 'success');
    assert.equal(project.status, 'resubmitted');
    assert.equal(project.revisionRequest.active, false);
    assert.equal(project.revisionHistory.length, 1);
    assert.equal(project.revisionHistory[0].snapshot.title, 'Versioned Project');
    assert.equal(project.revisionHistory[0].reviewOutcome, 'changes_requested');
    assert.equal(project.revisionHistory[0].submittedBy, 'leader-1');
    assert.ok(createdNotifications.some((notification) => notification.recipient === 'faculty-1'));
  });
});

test('revision after the original deadline requires an explicit extension', async () => {
  await withPatchedModels(async () => {
    const now = Date.now();
    const deadline = {
      isActive: true,
      submissionStartDate: new Date(now - 10 * 86400000),
      submissionEndDate: new Date(now - 86400000),
    };
    const project = {
      _id: 'project-revision-deadline',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      status: 'revision_required',
      title: 'Revision Deadline Project',
      submittedAt: new Date(now - 3 * 86400000),
      deadline: 'deadline-revision-expired',
      files: { reportUrl: '/report', pptUrl: '/slides', codeZipUrl: '/source' },
      revisionRequest: { active: true, status: 'granted', editableFields: ['methodology'], fileTypes: [] },
      revisionHistory: [],
      save: async function () { return this; },
    };
    Project.findById = async () => project;
    Deadline.findById = async () => deadline;
    let receivedError;
    await projectController.resubmitProject(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() {} },
      (error) => { receivedError = error; },
    );
    assert.equal(receivedError.statusCode, 400);
    assert.match(receivedError.message, /extension is required/);
    assert.equal(project.status, 'revision_required');

    project.revisionRequest.dueDate = new Date(now + 86400000);
    Notification.create = async () => ({ ok: true });
    let responseBody;
    await projectController.resubmitProject(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.equal(responseBody.status, 'success');
    assert.equal(project.status, 'resubmitted');
  });
});

test('unauthorized user cannot run uniqueness check', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-1',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      title: 'Project A',
      status: 'proposal_created',
      abstract: 'AI abstract',
      problemStatement: 'Problem',
      objectives: 'Goal',
      methodology: 'Method',
      technologies: 'React',
      expectedOutcome: 'Output',
      domain: 'AI',
      cohortId: 'IT-2023-E',
      save: async function () { return this; },
    };

    Project.findById = async () => project;

    let error;
    await projectController.runUniquenessCheck(
      { params: { id: 'project-1' }, user: { id: 'student-2', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.ok(error);
    assert.equal(error.statusCode, 403);
  });
});

test('team leader can run uniqueness check and gets a similarity result', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-1',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      title: 'Project A',
      status: 'proposal_created',
      abstract: 'AI based system for document classification',
      problemStatement: 'We need better document classification using machine learning',
      objectives: 'Improve classifications and support decision making',
      methodology: 'Use logistic regression and feature extraction',
      technologies: 'Python React MongoDB',
      expectedOutcome: 'Better classification model',
      domain: 'AI',
      cohortId: 'IT-2023-E',
      uniquenessCheck: { status: 'not_checked' },
      save: async function () { return this; },
    };

    const similarProject = {
      _id: 'project-2',
      leader: 'leader-2',
      teamMembers: ['leader-2'],
      title: 'AI Document Classification Portal',
      status: 'proposal_created',
      abstract: 'AI based system for document classification and review',
      problemStatement: 'We build a document classification system with AI assistance',
      objectives: 'Support decision making by improving classification',
      methodology: 'Apply machine learning and feature extraction',
      technologies: 'Python React MongoDB',
      expectedOutcome: 'A better classification system',
      domain: 'AI',
      cohortId: 'IT-2023-E',
    };

    Project.findById = async () => project;
    Project.find = async () => [similarProject];

    let responseBody;
    await projectController.runUniquenessCheck(
      { params: { id: 'project-1' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(responseBody.status, 'success');
    assert.ok(['needs_attention', 'high_similarity'].includes(responseBody.result.result));
    assert.ok(responseBody.result.overallScore >= 0);
    assert.ok(Array.isArray(responseBody.result.matches));
    assert.equal(project.status, 'uniqueness_checked');
  });
});

test('legacy draft projects cannot bypass proposal approval for formal submission', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'legacy-draft-project',
      leader: 'leader-1',
      status: 'draft',
      save: async () => { throw new Error('draft must not be saved as submitted'); },
    };
    Project.findById = async () => project;
    let receivedError;
    await projectController.submitProject(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() {} },
      (error) => { receivedError = error; },
    );
    assert.equal(receivedError.statusCode, 400);
    assert.equal(project.status, 'draft');
  });
});

test('student can formally submit a valid proposal within the active deadline window', async () => {
  await withPatchedModels(async () => {
    const now = new Date();
    const project = {
      _id: '650000000000000000000001',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      title: 'Valid Proposal',
      abstract: 'A carefully documented system for learning analytics.',
      problemStatement: 'We need a learning analytics dashboard for students and faculty.',
      status: 'faculty_accepted',
      files: {
        reportUrl: 'https://example.com/report.pdf',
        pptUrl: 'https://example.com/presentation.pptx',
        codeZipUrl: 'https://example.com/source.zip',
      },
      save: async function () { return this; },
    };

    const deadline = {
      _id: '650000000000000000000002',
      isActive: true,
      submissionStartDate: new Date(now.getTime() - 86400000),
      submissionEndDate: new Date(now.getTime() + 86400000),
    };

    let findByIdCalls = 0;
    Project.findById = () => {
      findByIdCalls += 1;
      if (findByIdCalls < 3) return Promise.resolve(project);
      return {
        populate() { return this; },
        then(resolve, reject) { return Promise.resolve(project).then(resolve, reject); },
      };
    };
    Project.find = async () => [];
    Deadline.findById = async () => deadline;
    TeamInvitation.findOne = async () => null;
    ProjectMember.countDocuments = async () => project.teamMembers.length;
    User.find = async () => [{ _id: 'leader-1', email: 'leader@example.com' }];
    Notification.create = async () => { throw new Error('simulated notification outage'); };
    PlagiarismResult.create = async (result) => ({ _id: '650000000000000000000003', ...result });

    let responseBody;
    await projectController.submitProject(
      { params: { id: '650000000000000000000001' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(responseBody.status, 'success');
    assert.equal(project.status, 'submitted');
    assert.ok(project.submittedAt instanceof Date);
    assert.equal(project.stageSubmissions[0].phase, 'final');
    assert.equal(project.stageSubmissions[0].version, 1);
  });
});

test('failed final project save does not leave the project marked submitted', async () => {
  await withPatchedModels(async () => {
    const now = Date.now();
    const project = {
      _id: 'project-submit-save-failure',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      title: 'Database Failure Submission',
      abstract: 'A project with enough details for the normal final submission checks.',
      problemStatement: 'A workflow must not claim success if the durable save fails.',
      status: 'faculty_accepted',
      deadline: 'deadline-save-failure',
      files: { reportUrl: '/report', pptUrl: '/slides', codeZipUrl: '/source' },
      save: async () => { throw new Error('simulated final project database failure'); },
    };
    Project.findById = async () => project;
    Project.find = async () => [];
    Deadline.findById = async () => ({
      isActive: true,
      submissionStartDate: new Date(now - 86400000),
      submissionEndDate: new Date(now + 86400000),
    });
    TeamInvitation.findOne = async () => null;
    ProjectMember.countDocuments = async () => 1;
    PlagiarismResult.create = async () => ({ _id: 'plagiarism-result-1' });

    let receivedError;
    await projectController.submitProject(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() {} },
      (error) => { receivedError = error; },
    );
    assert.match(receivedError.message, /final project database failure/);
    assert.equal(project.status, 'faculty_accepted');
    assert.equal(project.submittedAt, undefined);
  });
});

test('proposal review submission validates, runs the existing check, and advances the saved status', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: '650000000000000000000021',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      title: 'Learning Analytics Portal',
      domain: 'Education',
      abstract: 'A dashboard for learning progress and course outcomes.',
      problemStatement: 'Students need clear learning progress information.',
      objectives: 'Present useful and accurate learning analytics.',
      methodology: 'Analyze course activity and assessment outcomes.',
      technologies: 'React Node MongoDB',
      expectedOutcome: 'A clear dashboard for students and advisors.',
      status: 'proposal_created',
      save: async function () { return this; },
    };
    Project.findById = async () => project;
    Project.find = async () => [];
    Project.findOneAndUpdate = async () => project;

    let responseBody;
    await projectController.submitProposalForReview(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; }
    );

    assert.equal(responseBody.status, 'success');
    assert.equal(responseBody.project.status, 'uniqueness_checked');
    assert.equal(project.status, 'uniqueness_checked');
    assert.equal(responseBody.result.status, 'completed');
  });
});

test('proposal review submission rejects wrong owners, invalid states, incomplete proposals, and duplicate requests', async () => {
  await withPatchedModels(async () => {
    const completeProposal = {
      _id: '650000000000000000000022',
      leader: 'leader-1',
      title: 'Proposal',
      domain: 'Education',
      abstract: 'A complete project abstract.',
      problemStatement: 'A complete problem statement.',
      objectives: 'A complete objective.',
      methodology: 'A complete method.',
      technologies: 'React Node',
      expectedOutcome: 'A complete expected outcome.',
      status: 'proposal_created',
    };
    const scenarios = [
      { project: completeProposal, userId: 'student-2', statusCode: 403, message: /project leader/i },
      { project: { ...completeProposal, status: 'faculty_review' }, userId: 'leader-1', statusCode: 409, message: /not eligible|already submitted/i },
      { project: { ...completeProposal, abstract: '' }, userId: 'leader-1', statusCode: 400, message: /abstract is required/i },
      { project: { ...completeProposal, status: 'uniqueness_checked' }, userId: 'leader-1', statusCode: 409, message: /not eligible|already submitted/i },
      { project: completeProposal, userId: 'leader-1', statusCode: 409, message: /already been submitted|being processed/i, claimFails: true },
    ];

    for (const scenario of scenarios) {
      Project.findById = async () => scenario.project;
      Project.findOneAndUpdate = async () => scenario.claimFails ? null : scenario.project;
      Project.find = async () => assert.fail('Rejected proposal must not run a duplicate similarity check');
      let error;
      await projectController.submitProposalForReview(
        { params: { id: scenario.project._id }, user: { id: scenario.userId, role: 'student' } },
        { status() { return this; }, json() { return this; } },
        (nextError) => { error = nextError; }
      );

      assert.equal(error?.statusCode, scenario.statusCode);
      assert.match(error.message, scenario.message);
    }
  });
});

test('proposal review and faculty approval unlock final submission without weakening deliverable requirements', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: '650000000000000000000031',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      files: {},
      save: async function () { return this; },
    };
    const deadline = {
      _id: '650000000000000000000032',
      batch: '2026-2030',
      isActive: true,
      submissionStartDate: new Date(Date.now() - 86400000),
      submissionEndDate: new Date(Date.now() + 86400000),
    };
    const populateQuery = {
      populate() { return this; },
      then(resolve, reject) { return Promise.resolve(project).then(resolve, reject); },
    };

    Project.findOne = async () => null;
    Project.create = async (payload) => Object.assign(project, payload, { _id: project._id, files: {} });
    Project.findById = () => populateQuery;
    Project.findOneAndUpdate = async () => project;
    ProjectMember.create = async () => ({ ok: true });
    Deadline.findById = async () => deadline;
    let projectFindCalls = 0;
    Project.find = (filter) => {
      projectFindCalls += 1;
      if (projectFindCalls === 1) return Promise.resolve([]);
      if (projectFindCalls === 2 || projectFindCalls === 3) {
        assert.ok(filter.$or[0].status.$in.includes('uniqueness_checked'));
      }
      if (projectFindCalls === 3) {
        assert.ok(filter.$or[0].status.$in.includes('faculty_review'));
        assert.equal(String(filter.assignedFaculty), 'faculty-1');
      }
      return {
        populate() { return this; },
        sort: async () => [project],
      };
    };

    const student = {
      id: 'leader-1',
      role: 'student',
      department: 'Computer Science',
      section: 'A',
      batch: '2026-2030',
      academicYear: '2026',
    };
    const proposalBody = {
      title: 'Learning Analytics Portal',
      domain: 'Education',
      abstract: 'A dashboard for learning progress and course outcomes.',
      problemStatement: 'Students need clear learning progress information.',
      objectives: 'Present useful and accurate learning analytics.',
      methodology: 'Analyze course activity and assessment outcomes.',
      technologies: 'React Node MongoDB',
      expectedOutcome: 'A clear dashboard for students and advisors.',
      deadline: deadline._id,
    };
    let responseBody;
    await projectController.createProject(
      { body: proposalBody, user: student },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; }
    );
    assert.equal(responseBody.project.status, 'proposal_created');
    assert.equal(responseBody.project.deadline, deadline._id);

    await projectController.submitProposalForReview(
      { params: { id: project._id }, user: student },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; }
    );
    assert.equal(responseBody.project.status, 'uniqueness_checked');

    await projectController.getProposalReviewProjects(
      { user: { id: 'admin-1', role: 'admin' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; }
    );
    assert.equal(responseBody.projects[0].status, 'uniqueness_checked');

    project.assignedFaculty = 'faculty-1';
    project.status = 'faculty_review';
    await projectController.getProposalReviewProjects(
      { user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; }
    );
    assert.equal(responseBody.projects[0].status, 'faculty_review');

    await projectController.reviewProject(
      { params: { id: project._id }, body: { decision: 'accepted' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; }
    );
    assert.equal(project.status, 'faculty_accepted');
    project.stageSubmissions = [
      { phase: 'abstract', version: 1, status: 'approved' },
      { phase: 'midterm', version: 1, status: 'approved' },
    ];

    TeamInvitation.findOne = async () => null;
    ProjectMember.countDocuments = async () => 1;
    let submitError;
    await projectController.submitProject(
      { params: { id: project._id }, user: student },
      { status() { return this; }, json() { return this; } },
      (error) => { submitError = error; }
    );
    assert.equal(submitError?.statusCode, 400);
    assert.match(submitError.message, /report \(PDF\) is required/i);
    assert.equal(project.status, 'faculty_accepted');
  });
});

test('formal submission is rejected before the cohort window opens', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: '650000000000000000000011',
      leader: 'leader-1',
      status: 'faculty_accepted',
      deadline: '650000000000000000000012',
    };
    Project.findById = async () => project;
    Deadline.findById = async () => ({
      isActive: true,
      batch: 'Batch 2027',
      submissionStartDate: new Date(Date.now() + 86400000),
      submissionEndDate: new Date(Date.now() + 172800000),
    });

    let error;
    await projectController.submitProject(
      { params: { id: project._id }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (nextError) => { error = nextError; }
    );

    assert.equal(error?.statusCode, 400);
    assert.match(error.message, /window has not opened/i);
    assert.equal(project.status, 'faculty_accepted');
  });
});

test('similarity check excludes the current project and stores comparison details', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-1',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      title: 'AI Document Classifier',
      status: 'proposal_created',
      abstract: 'We propose an AI document classifier using transformer embeddings and feature extraction.',
      problemStatement: 'Organizations need a better way to classify incoming documents with high accuracy.',
      objectives: 'Improve classification accuracy and reduce manual triage for document handling.',
      methodology: 'Use transformer embeddings with a dense classification layer and evaluate against a benchmark dataset.',
      technologies: 'Python TensorFlow MongoDB React',
      expectedOutcome: 'A system that classifies incoming documents with transparent metrics.',
      domain: 'AI',
      description: 'Organizations need a better way to classify incoming documents with high accuracy.',
      uniquenessCheck: { status: 'not_checked' },
      save: async function () { return this; },
    };

    const matchingProject = {
      _id: 'project-2',
      leader: 'leader-2',
      teamMembers: ['leader-2'],
      title: 'Document Classification with AI',
      status: 'proposal_created',
      abstract: 'We propose an AI document classifier using transformer embeddings and feature extraction.',
      problemStatement: 'Organizations need a better way to classify incoming documents with high accuracy.',
      objectives: 'Improve classification accuracy and reduce manual triage for document handling.',
      methodology: 'Use transformer embeddings with a dense classification layer and evaluate against a benchmark dataset.',
      technologies: 'Python TensorFlow MongoDB React',
      expectedOutcome: 'A system that classifies incoming documents with transparent metrics.',
      domain: 'AI',
      description: 'Organizations need a better way to classify incoming documents with high accuracy.',
    };

    const differentProject = {
      _id: 'project-3',
      title: 'Solar Energy Optimization System',
      status: 'proposal_created',
      abstract: 'This project designs an optimizer for solar panel tilt based on weather data.',
      problemStatement: 'We aim to improve solar efficiency by analyzing weather patterns.',
      objectives: 'Forecast energy yield and adjust panel tilt in real time.',
      methodology: 'Use time-series forecasting and optimization heuristics.',
      technologies: 'Python SQL IoT',
      expectedOutcome: 'Reduced energy loss across the solar field.',
      domain: 'Energy Systems',
      description: 'We aim to improve solar efficiency by analyzing weather patterns.',
    };

    Project.findById = async () => project;
    Project.find = async () => [matchingProject, differentProject];

    let responseBody;
    await projectController.runUniquenessCheck(
      { params: { id: 'project-1' }, user: { id: 'leader-1', role: 'student' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(responseBody.status, 'success');
    assert.equal(responseBody.result.status, 'completed');
    assert.equal(project.status, 'uniqueness_checked');
    assert.ok(responseBody.result.algorithm.includes('TF-IDF + Cosine Similarity'));
    assert.ok(Array.isArray(responseBody.result.matches[0].sectionComparisons));
    assert.equal(responseBody.result.matches[0].sectionComparisons.length, 7);
    assert.equal(responseBody.result.matches[0].sectionComparisons.find((section) => section.field === 'abstract').comparable, true);
    assert.ok(Array.isArray(responseBody.result.matches));
    assert.equal(responseBody.result.matches.some((match) => match.projectId?.toString?.() === 'project-1'), false);
    assert.ok(responseBody.result.matches[0].similarityScore >= 0);

    const { getSimilaritySemanticLabel, getSimilaritySectionScore } = await import(pathToFileURL(require('node:path').resolve(__dirname, '../../client/src/utils/similarityDisplay.js')).href);
    const firstMatch = responseBody.result.matches[0];
    const titleComparison = firstMatch.sectionComparisons.find((section) => section.field === 'title');
    assert.equal(
      getSimilaritySemanticLabel(firstMatch),
      firstMatch.semanticStatus === 'available'
        ? `${firstMatch.semanticSimilarity}% Sentence-BERT similarity`
        : 'Sentence-BERT score unavailable',
    );
    assert.equal(getSimilaritySectionScore(titleComparison), `${titleComparison.similarityScore}% text similarity`);
  });
});

test('similar titles with different purposes retain separate section evidence', async () => {
  await withPatchedModels(() => withEnvironment({ ENABLE_SEMANTIC_SIMILARITY: 'false' }, async () => {
    const project = makeSimilarityProject('title-current', {
      title: 'AI Powered Student Academic Performance Prediction System',
      abstract: 'Predict student grades from attendance and assessment history to provide early learning support.',
    });
    const candidate = makeSimilarityProject('title-candidate', {
      title: 'AI Powered Student Academic Performance Prediction System for Course Scheduling',
      abstract: 'Allocate classroom periods and instructor availability across university timetables.',
    });
    const result = await runSimilarityCheck(project, [candidate]);
    const sections = result.matches[0].sectionComparisons;

    assert.ok(sections.find((section) => section.field === 'title').similarityScore > 0);
    assert.deepEqual(sections.find((section) => section.field === 'abstract').matchingTerms, []);
    assert.ok(sections.find((section) => section.field === 'abstract').explanation.includes('no distinctive shared terms'));
  }));
});

test('different titles with overlapping descriptions identify the matching sections', async () => {
  await withPatchedModels(() => withEnvironment({ ENABLE_SEMANTIC_SIMILARITY: 'false' }, async () => {
    const sharedAbstract = 'Analyze academic records to identify students who may need timely support.';
    const project = makeSimilarityProject('description-current', {
      title: 'Student Success Forecasting',
      abstract: sharedAbstract,
    });
    const candidate = makeSimilarityProject('description-candidate', {
      title: 'Campus Learner Support Insights',
      abstract: sharedAbstract,
    });
    const result = await runSimilarityCheck(project, [candidate]);
    const sections = result.matches[0].sectionComparisons;

    assert.equal(sections.find((section) => section.field === 'title').matchingTerms.length, 0);
    assert.ok(sections.find((section) => section.field === 'abstract').matchingTerms.includes('academic'));
    assert.ok(sections.find((section) => section.field === 'abstract').similarityScore > 0);
  }));
});

test('shared technologies are reported as tools rather than conceptual plagiarism evidence', async () => {
  await withPatchedModels(() => withEnvironment({ ENABLE_SEMANTIC_SIMILARITY: 'false' }, async () => {
    const project = makeSimilarityProject('tools-current', {
      title: 'Crop Disease Field Monitor',
      abstract: 'Inspect leaf images to identify crop disease symptoms in farm plots.',
      problemStatement: 'Farmers need timely alerts about plant health conditions.',
      objectives: 'Detect visible crop symptoms before they spread.',
      methodology: 'Capture and classify images collected from field surveys.',
      technologies: 'Python React MongoDB',
      expectedOutcome: 'Earlier crop treatment decisions for local growers.',
      description: 'An agricultural plant health project.',
    });
    const candidate = makeSimilarityProject('tools-candidate', {
      title: 'Library Seat Reservation',
      abstract: 'Allow readers to reserve study spaces before arriving at the library.',
      problemStatement: 'Libraries need a way to coordinate room and seat usage.',
      objectives: 'Show which study spaces are available throughout the day.',
      methodology: 'Collect reservations and update seat availability.',
      technologies: 'Python React MongoDB',
      expectedOutcome: 'A reservation schedule for campus readers.',
      description: 'A campus library booking project.',
    });
    const result = await runSimilarityCheck(project, [candidate]);
    const sections = result.matches[0].sectionComparisons;

    assert.ok(sections.find((section) => section.field === 'technologies').matchingTerms.includes('python'));
    assert.ok(sections.filter((section) => section.field !== 'technologies').every((section) => section.matchingTerms.length === 0));
    assert.match(sections.find((section) => section.field === 'technologies').explanation, /alone do not establish copied work/i);
    assert.notEqual(result.result, 'high_similarity');
  }));
});

test('missing section text is marked not comparable rather than assigned zero similarity', async () => {
  await withPatchedModels(() => withEnvironment({ ENABLE_SEMANTIC_SIMILARITY: 'false' }, async () => {
    const project = makeSimilarityProject('missing-current');
    const candidate = makeSimilarityProject('missing-candidate', { abstract: '' });
    const result = await runSimilarityCheck(project, [candidate]);
    const abstract = result.matches[0].sectionComparisons.find((section) => section.field === 'abstract');

    assert.equal(abstract.currentTextAvailable, true);
    assert.equal(abstract.matchedTextAvailable, false);
    assert.equal(abstract.comparable, false);
    assert.equal(abstract.similarityScore, null);
    assert.match(abstract.explanation, /text is missing/i);
  }));
});

test('disabled or failed semantic comparisons do not persist fallback values as semantic scores', async () => {
  await withPatchedModels(async () => {
    const project = makeSimilarityProject('semantic-unavailable', {
      uniquenessCheck: { status: 'completed', overallScore: 94, matches: [{ semanticSimilarity: 88 }] },
    });
    const candidate = makeSimilarityProject('semantic-unavailable-candidate');
    await withEnvironment({ ENABLE_SEMANTIC_SIMILARITY: 'false' }, async () => {
      const result = await runSimilarityCheck(project, [candidate]);
      const match = result.matches[0];

      assert.equal(result.semanticStatus, 'unavailable');
      assert.match(result.algorithm, /Sentence-BERT disabled/i);
      assert.equal(match.semanticStatus, 'unavailable');
      assert.equal(match.semanticSimilarity, null);
      assert.equal(match.scoreBreakdown.semanticSimilarity, null);
      assert.equal(match.scoreBreakdown.textWeight, 100);
      assert.equal(match.scoreBreakdown.semanticWeight, 0);
      assert.equal(match.scoreBreakdown.combinedSimilarity, match.scoreBreakdown.textSimilarity);
      assert.notEqual(result.overallScore, 94);
    });

    await withEnvironment({
      ENABLE_SEMANTIC_SIMILARITY: 'true',
      SEMANTIC_MODEL: 'missing-test-model',
      PYTHON_BIN: 'evalportal-missing-python-executable',
    }, async () => {
      const result = await runSimilarityCheck(project, [candidate]);
      assert.equal(result.semanticStatus, 'unavailable');
      assert.match(result.algorithm, /Sentence-BERT unavailable/i);
      assert.equal(result.matches[0].semanticSimilarity, null);
      assert.equal(result.matches[0].scoreBreakdown.textWeight, 100);
    });
  });
});

test('successful semantic scores combine with text using the recorded normalized weights', async () => {
  await withPatchedModels(() => withEnvironment({
    ENABLE_SEMANTIC_SIMILARITY: 'true',
    SEMANTIC_MODEL: 'cached-test-model',
  }, async () => {
    const project = makeSimilarityProject('semantic-current');
    const candidate = makeSimilarityProject('semantic-candidate', { title: 'Academic support forecasting tool' });
    const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const getComparisonText = (item) => comparisonFields
      .map((field) => item[field])
      .filter((value) => typeof value === 'string' && value.trim())
      .join(' ');
    const currentText = normalize(getComparisonText(project));
    const candidateText = normalize(getComparisonText(candidate));
    const currentKey = getEmbeddingCacheKey(currentText, process.env.SEMANTIC_MODEL);
    const candidateKey = getEmbeddingCacheKey(candidateText, process.env.SEMANTIC_MODEL);
    EMBEDDING_CACHE.set(currentKey, [1, 0]);
    EMBEDDING_CACHE.set(candidateKey, [0.6, 0.8]);

    try {
      const result = await runSimilarityCheck(project, [candidate]);
      const match = result.matches[0];
      const expectedCombined = (match.scoreBreakdown.textSimilarity * 0.65) + (60 * 0.35);

      assert.equal(match.semanticStatus, 'available');
      assert.equal(match.semanticSimilarity, 60);
      assert.equal(match.scoreBreakdown.textWeight, 65);
      assert.equal(match.scoreBreakdown.semanticWeight, 35);
      assert.equal(match.scoreBreakdown.combinedSimilarity, Number(expectedCombined.toFixed(2)));
      assert.match(result.algorithm, /Sentence-BERT \(1\/1 comparisons\)/);
    } finally {
      EMBEDDING_CACHE.delete(currentKey);
      EMBEDDING_CACHE.delete(candidateKey);
    }
  }));
});

test('similarity check marks insufficient text without faking a verified 0% match', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-4',
      leader: 'leader-4',
      teamMembers: ['leader-4'],
      title: 'Short',
      status: 'proposal_created',
      abstract: 'AI',
      problemStatement: '',
      objectives: '',
      methodology: '',
      technologies: '',
      expectedOutcome: '',
      domain: '',
      description: 'AI',
      uniquenessCheck: { status: 'not_checked' },
      save: async function () { return this; },
    };

    Project.findById = async () => project;
    Project.find = async () => [];

    let responseBody;
    await projectController.runUniquenessCheck(
      { params: { id: 'project-4' }, user: { id: 'leader-4', role: 'student' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(responseBody.status, 'success');
    assert.equal(responseBody.result.status, 'insufficient_text');
    assert.equal(responseBody.result.overallScore, 0);
    assert.ok(Array.isArray(responseBody.result.matches));
    assert.equal(responseBody.result.matches.length, 0);
  });
});

test('similarity check captures failed checks without treating them as a valid result', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-5',
      leader: 'leader-5',
      teamMembers: ['leader-5'],
      title: 'Project Five',
      status: 'proposal_created',
      abstract: 'This system detects anomalies in industrial data streams.',
      problemStatement: 'We need a reliable anomaly detector for industrial telemetry.',
      objectives: 'Improve issue detection and reduce downtime in operations.',
      methodology: 'Use streaming analytics and anomaly detection models.',
      technologies: 'Python Kafka ML',
      expectedOutcome: 'Improved operational visibility.',
      domain: 'Data Engineering',
      description: 'We need a reliable anomaly detector for industrial telemetry.',
      uniquenessCheck: { status: 'not_checked' },
      save: async function () { return this; },
    };

    Project.findById = async () => project;
    Project.find = async () => { throw new Error('comparison service unavailable'); };

    let error;
    await projectController.runUniquenessCheck(
      { params: { id: 'project-5' }, user: { id: 'leader-5', role: 'student' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.ok(error);
    assert.equal(error.statusCode, 500);
    assert.equal(project.uniquenessCheck.status, 'failed');
  });
});

test('dashboard similarity display uses saved check state rather than the default zero field', async () => {
  const {
    getSimilarityDisplayState,
    getSimilarityAlgorithmLabel,
    getSimilaritySemanticLabel,
    getSimilaritySectionScore,
  } = await import(pathToFileURL(require('node:path').resolve(__dirname, '../../client/src/utils/similarityDisplay.js')).href);
  const project = {
    plagiarismScore: 91,
    uniquenessCheck: { status: 'completed', overallScore: 26 },
  };

  const state = getSimilarityDisplayState(project);
  assert.equal(state.score, 26);
  assert.equal(state.label, '26% Text similarity');
  assert.match(state.tone, /red/);
  assert.equal(getSimilaritySemanticLabel({ semanticSimilarity: 72 }), 'Semantic score not recorded for this legacy result');
  assert.equal(getSimilaritySectionScore({ comparable: false, similarityScore: 0 }), 'Not comparable');
  assert.equal(getSimilarityAlgorithmLabel({ algorithm: 'TF-IDF + Cosine Similarity + Optional Sentence-BERT' }), 'Legacy result; Sentence-BERT execution was not recorded');
  assert.equal(getSimilarityDisplayState({ plagiarismScore: 90, uniquenessCheck: { status: 'failed', overallScore: 0 } }).score, null);
});

test('leader cannot edit a project after faculty assignment', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-edit-locked',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      title: 'Locked Project',
      status: 'proposal_created',
      assignedFaculty: 'faculty-1',
      description: 'Original description',
      problemStatement: 'Original problem statement',
      abstract: 'Original abstract',
      objectives: 'Original objectives',
      methodology: 'Original methodology',
      expectedOutcome: 'Original outcome',
      technologies: 'React',
      domain: 'AI',
      cohortId: 'IT-2023-E',
      save: async function () { return this; },
    };

    Project.findById = async () => project;
    let error;

    await projectController.updateProject(
      { params: { id: 'project-edit-locked' }, body: { title: 'Attempted edit' }, user: { id: 'leader-1', role: 'student', department: 'Information Technology', section: 'E', batch: '2023-2027', academicYear: '2023' } },
      { status() { return this; }, json() { return this; } },
      (err) => { error = err; }
    );

    assert.ok(error);
    assert.equal(error.statusCode, 400);
    assert.equal(project.title, 'Locked Project');
  });
});

test('faculty can accept a proposal for review', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-1',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      title: 'Project A',
      status: 'uniqueness_checked',
      uniquenessCheck: { result: 'likely_unique', overallScore: 30 },
      save: async function () { return this; },
      reviewedBy: undefined,
      reviewedAt: undefined,
      reviewDecision: undefined,
      facultyComment: undefined,
    };

    Project.findById = async () => project;
    User.findById = async () => ({ _id: 'faculty-1', role: 'faculty', name: 'Faculty User' });

    let responseBody;
    await projectController.reviewProject(
      { params: { id: 'project-1' }, body: { decision: 'accepted', facultyComment: 'Good work' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(responseBody.status, 'success');
    assert.equal(project.status, 'faculty_accepted');
    assert.equal(project.reviewDecision, 'accepted');
    assert.equal(project.facultyComment, 'Good work');
  });
});

test('faculty can reject a proposal with required feedback', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-rejected',
      leader: 'leader-1',
      teamMembers: ['leader-1'],
      assignedFaculty: 'faculty-1',
      status: 'uniqueness_checked',
      save: async function () { return this; },
    };
    Project.findById = async () => project;

    let missingCommentError;
    await projectController.reviewProject(
      { params: { id: project._id }, body: { decision: 'rejected' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json() {} },
      (error) => { missingCommentError = error; },
    );
    assert.equal(missingCommentError.statusCode, 400);

    let responseBody;
    await projectController.reviewProject(
      { params: { id: project._id }, body: { decision: 'rejected', facultyComment: 'The proposal needs a different scope.' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.equal(responseBody.status, 'success');
    assert.equal(project.status, 'rejected');
    assert.equal(project.reviewDecision, 'rejected');
    assert.equal(project.facultyComment, 'The proposal needs a different scope.');
  });
});

test('student can create a proposal draft without a configured formal review deadline', async () => {
  const originalProjectFindOne = Project.findOne;
  const originalProjectCreate = Project.create;
  const originalProjectFindById = Project.findById;
  const originalMemberCreate = ProjectMember.create;
  const createdProject = { _id: 'proposal-without-deadline' };
  Project.findOne = async () => null;
  Project.create = async (data) => Object.assign(createdProject, data);
  ProjectMember.create = async () => ({ _id: 'leader-membership' });
  Project.findById = () => ({
    populate() { return this; },
    then(resolve) { return Promise.resolve(createdProject).then(resolve); },
  });

  try {
    let responseBody;
    await projectController.createProject({
      body: {
        title: 'Proposal draft without deadline',
        domain: 'Education',
        abstract: 'A valid proposal abstract for the project.',
        problemStatement: 'Students need support.',
        objectives: 'Identify learners needing support.',
        methodology: 'Analyze course activity.',
        technologies: 'React, Node',
        expectedOutcome: 'Timely recommendations.',
      },
      user: { id: 'leader-1', role: 'student', department: 'Information Technology', section: 'E', batch: '2023-2027' },
    }, { status() { return this; }, json(body) { responseBody = body; return this; } }, (error) => { throw error; });
    assert.equal(responseBody.project.status, 'proposal_created');
    assert.equal(responseBody.project.deadline, undefined);
    assert.equal(responseBody.project.stageWorkflowEnabled, true);
  } finally {
    Project.findOne = originalProjectFindOne;
    Project.create = originalProjectCreate;
    Project.findById = originalProjectFindById;
    ProjectMember.create = originalMemberCreate;
  }
});

test('student can request workspace revision access and faculty can grant only selected permissions', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'workspace-access-project',
      leader: 'leader-1',
      teamMembers: ['leader-1', 'member-1'],
      assignedFaculty: 'faculty-1',
      title: 'Workspace access project',
      batch: '2023-2027',
      deadline: 'deadline-1',
      status: 'faculty_accepted',
      files: {},
      save: async function () { return this; },
    };
    Project.findById = async () => project;
    Deadline.findById = async () => ({
      batch: 'Batch 2027',
      isActive: true,
      submissionStartDate: new Date(Date.now() - 86400000),
      submissionEndDate: new Date(Date.now() + 86400000),
    });

    let requestBody;
    await projectController.requestRevisionAccess(
      { params: { id: project._id }, body: { reason: 'I need to correct the methodology and report.' }, user: { id: 'member-1', role: 'student' } },
      { status() { return this; }, json(body) { requestBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.equal(requestBody.request.status, 'pending');
    assert.equal(project.revisionRequest, undefined);

    let responseBody;
    await projectController.respondToRevisionAccessRequest(
      { params: { id: project._id }, body: { decision: 'grant', editableFields: ['methodology', 'title'], fileTypes: ['report'] }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.equal(responseBody.request.status, 'granted');
    assert.deepEqual(project.revisionRequest.editableFields, ['methodology', 'title']);
    assert.deepEqual(project.revisionRequest.fileTypes, ['report']);
    assert.equal(project.revisionRequest.active, true);
    assert.equal(project.status, 'faculty_accepted');
  });
});

test('faculty can deny a student revision permission request without granting edits', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'workspace-denied-access-project',
      teamMembers: ['student-1'],
      assignedFaculty: 'faculty-1',
      revisionAccessRequest: { status: 'pending', reason: 'Please allow an edit.' },
      save: async function () { return this; },
    };
    Project.findById = async () => project;
    let responseBody;
    await projectController.respondToRevisionAccessRequest(
      { params: { id: project._id }, body: { decision: 'deny' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.equal(responseBody.request.status, 'denied');
    assert.equal(project.revisionRequest, undefined);
  });
});

test('faculty can grant a proposal revision request without a formal review deadline', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'proposal-revision-access-project',
      leader: 'student-1',
      teamMembers: ['student-1'],
      assignedFaculty: 'faculty-1',
      status: 'faculty_accepted',
      stageWorkflowEnabled: true,
      revisionAccessRequest: { status: 'pending', reason: 'Correct the proposal objectives.' },
      save: async function () { return this; },
    };
    Project.findById = async () => project;
    let responseBody;
    await projectController.respondToRevisionAccessRequest(
      { params: { id: project._id }, body: { decision: 'grant', editableFields: ['objectives'], fileTypes: [] }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.equal(responseBody.revisionRequest.phase, 'proposal');
    assert.equal(responseBody.revisionRequest.active, true);
    assert.deepEqual(responseBody.revisionRequest.editableFields, ['objectives']);
  });
});

test('assigned proposal queue includes pending Workspace permission requests', async () => {
  const originalProjectFind = Project.find;
  const project = {
    _id: 'workspace-request-queue-project',
    status: 'faculty_accepted',
    assignedFaculty: 'faculty-1',
    revisionAccessRequest: { status: 'pending', reason: 'Please permit a report correction.' },
  };
  let capturedFilter;
  Project.find = (filter) => {
    capturedFilter = filter;
    return {
      populate() { return this; },
      sort: async () => [project],
    };
  };
  try {
    let responseBody;
    await projectController.getProposalReviewProjects(
      { user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.ok(capturedFilter.$or.some((filter) => filter['revisionAccessRequest.status'] === 'pending'));
    assert.equal(responseBody.projects[0].revisionAccessRequest.status, 'pending');
  } finally {
    Project.find = originalProjectFind;
  }
});

test('assigned faculty review queue includes submitted and resubmitted projects', async () => {
  await withPatchedModels(async () => {
    let capturedFilter;
    Project.find = (filter) => {
      capturedFilter = filter;
      return {
        populate() { return this; },
        sort: async () => [],
      };
    };
    let responseBody;
    await projectController.getFacultyReviewProjects(
      { user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (error) => { throw error; },
    );
    assert.ok(capturedFilter.status.$in.includes('submitted'));
    assert.ok(capturedFilter.status.$in.includes('resubmitted'));
    assert.ok(capturedFilter.status.$in.includes('revision_required'));
    assert.equal(capturedFilter.assignedFaculty, 'faculty-1');
    assert.equal(responseBody.status, 'success');
  });
});

test('unassigned faculty cannot review a submitted project', async () => {
  await withPatchedModels(async () => {
    Project.findById = async () => ({
      _id: 'unassigned-project',
      assignedFaculty: null,
      status: 'submitted',
    });
    let receivedError;
    await projectController.reviewProject(
      { params: { id: 'unassigned-project' }, body: { decision: 'accepted' }, user: { id: 'faculty-1', role: 'faculty' } },
      { status() { return this; }, json() {} },
      (error) => { receivedError = error; },
    );
    assert.equal(receivedError.statusCode, 403);
  });
});

test('accepting invitation adds member and sends a leader email', async () => {
  await withPatchedModels(async () => {
    const leader = { _id: 'leader-1', id: 'leader-1', name: 'Leader One', email: 'leader@example.com' };
    const invitee = { _id: 'student-2', id: 'student-2', name: 'Student Two', email: 'student2@example.com', role: 'student', department: 'Information Technology', section: 'E', batch: '2023-2027' };
    const project = {
      _id: 'project-1',
      leader: 'leader-1',
      title: 'Test Project',
      status: 'proposal_created',
      cohortId: 'IT-2023-E',
      teamMembers: ['leader-1'],
      deadline: 'deadline-1',
      save: async function () { return this; },
    };
    const invitation = {
      _id: 'inv-1',
      project: { _id: 'project-1', title: 'Test Project' },
      invitedBy: leader,
      invitedUser: invitee._id,
      status: 'pending',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      save: async function () { return this; },
    };

    Project.findById = async () => project;
    TeamInvitation.findOne = async () => invitation;
    TeamInvitation.findOneAndUpdate = async (_filter, update) => {
      Object.assign(invitation, update.$set);
      return invitation;
    };
    ProjectMember.findOne = async () => null;
    ProjectMember.create = async () => ({ ok: true });
    Project.findOne = async () => null;
    Notification.create = async () => ({ ok: true });
    let emailSent = false;
    const originalSend = require('../src/services/emailService').sendTeamMemberAcceptedEmail;
    require('../src/services/emailService').sendTeamMemberAcceptedEmail = async () => {
      emailSent = true;
      return true;
    };

    let responseBody;
    await invitationController.acceptInvitation(
      { params: { token: 'abc' }, user: invitee },
      { status() { return this; }, json(body) { responseBody = body; return this; } },
      (err) => { throw err; }
    );

    assert.equal(responseBody.status, 'success');
    assert.equal(emailSent, true);
    require('../src/services/emailService').sendTeamMemberAcceptedEmail = originalSend;
  });
});
