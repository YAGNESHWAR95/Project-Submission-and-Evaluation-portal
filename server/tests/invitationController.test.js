const test = require('node:test');
const assert = require('node:assert/strict');

const invitationController = require('../src/controllers/invitationController');
const Project = require('../src/models/Project');
const User = require('../src/models/User');
const TeamInvitation = require('../src/models/TeamInvitation');
const ProjectMember = require('../src/models/ProjectMember');
const Notification = require('../src/models/Notification');
const { getCohortId } = require('../src/utils/cohort');
const emailService = require('../src/services/emailService');

const originalProjectFindById = Project.findById;
const originalProjectFindOne = Project.findOne;
const originalUserFindOne = User.findOne;
const originalUserFind = User.find;
const originalTeamInvitationFind = TeamInvitation.find;
const originalTeamInvitationFindOne = TeamInvitation.findOne;
const originalTeamInvitationFindOneAndUpdate = TeamInvitation.findOneAndUpdate;
const originalTeamInvitationCreate = TeamInvitation.create;
const originalProjectMemberCreate = ProjectMember.create;
const originalProjectMemberFindOne = ProjectMember.findOne;
const originalNotificationCreate = Notification.create;
const originalSendTeamInvitationEmail = emailService.sendTeamInvitationEmail;
const originalSendTeamMemberAcceptedEmail = emailService.sendTeamMemberAcceptedEmail;
const originalSendTeamMemberRejectedEmail = emailService.sendTeamMemberRejectedEmail;

async function withPatchedModels(run) {
  emailService.sendTeamInvitationEmail = async () => true;
  emailService.sendTeamMemberAcceptedEmail = async () => true;
  emailService.sendTeamMemberRejectedEmail = async () => true;
  try {
    await run();
  } finally {
    Project.findById = originalProjectFindById;
    Project.findOne = originalProjectFindOne;
    User.findOne = originalUserFindOne;
    User.find = originalUserFind;
    TeamInvitation.find = originalTeamInvitationFind;
    TeamInvitation.findOne = originalTeamInvitationFindOne;
    TeamInvitation.findOneAndUpdate = originalTeamInvitationFindOneAndUpdate;
    TeamInvitation.create = originalTeamInvitationCreate;
    ProjectMember.create = originalProjectMemberCreate;
    ProjectMember.findOne = originalProjectMemberFindOne;
    Notification.create = originalNotificationCreate;
    emailService.sendTeamInvitationEmail = originalSendTeamInvitationEmail;
    emailService.sendTeamMemberAcceptedEmail = originalSendTeamMemberAcceptedEmail;
    emailService.sendTeamMemberRejectedEmail = originalSendTeamMemberRejectedEmail;
  }
}

async function exerciseSendInvitation({ leader, invitee, teamMemberIds = [], existingInvitation = null, existingMembership = null, otherProject = null, emailResult = true, projectStatus = 'proposal_created' }) {
  const project = {
    _id: 'project-1',
    leader: leader.id,
    status: projectStatus,
    title: 'Test Project',
    cohortId: getCohortId(leader),
    deadline: 'deadline-1',
    teamMembers: [leader.id, ...teamMemberIds],
  };
  Project.findById = async () => project;
  Project.findOne = async () => otherProject;
  User.findOne = async () => invitee;
  TeamInvitation.findOne = async (filter) => (
    existingInvitation
    && (!filter.expiresAt?.$gt || (existingInvitation.expiresAt && new Date(existingInvitation.expiresAt) > filter.expiresAt.$gt))
      ? existingInvitation
      : null
  );
  TeamInvitation.create = async (doc) => ({
    ...doc,
    _id: 'inv-new',
    invitedUser: invitee,
    save: async function () { return this; },
    populate: async () => {},
  });
  ProjectMember.findOne = async () => existingMembership;
  let notificationCreates = 0;
  Notification.create = async () => {
    notificationCreates += 1;
    return { ok: true };
  };
  let emailDetails;
  emailService.sendTeamInvitationEmail = async (details) => {
    emailDetails = details;
    return typeof emailResult === 'function' ? emailResult(details) : emailResult;
  };

  let capturedError;
  let statusCode;
  let responseBody;
  const req = {
    body: { projectId: project._id, studentIdentifier: invitee?.email || 'missing@example.com' },
    user: leader,
  };
  const res = { status(code) { statusCode = code; return this; }, json(body) { responseBody = body; return this; } };
  await invitationController.sendInvitation(req, res, (error) => { capturedError = error; });
  return { error: capturedError, statusCode, responseBody, notificationCreates, emailDetails };
}

const createInvitationFixture = ({ expiresAt = new Date(Date.now() + 86400000), status = 'pending', memberExists = false } = {}) => {
  const leader = { _id: 'leader-id', name: 'Leader One', email: 'leader@example.com', rollNumber: 'LEADER-1' };
  const invitee = {
    _id: 'student-2',
    id: 'student-2',
    name: 'Student Two',
    email: 'student2@example.com',
    rollNumber: '23IT0002',
    department: 'Information Technology',
    section: 'E',
    batch: '2023-2027',
  };
  const project = {
    _id: 'project-1',
    leader: leader._id,
    title: 'ML Portal',
    status: 'proposal_created',
    cohortId: 'IT-2023-E',
    deadline: 'deadline-1',
    teamMembers: memberExists ? [leader._id, invitee._id] : [leader._id],
    save: async function () { return this; },
  };
  const invitation = {
    _id: 'inv-1',
    token: 'token-123',
    status,
    expiresAt,
    invitedUser: invitee._id,
    invitedBy: leader,
    project,
    save: async function () { return this; },
    populate(paths) { this.populatedPaths = paths; return this; },
  };

  let membership = memberExists ? { project: project._id, user: invitee._id } : null;
  let membershipCreates = 0;
  const notifications = [];
  TeamInvitation.findOne = async () => invitation;
  TeamInvitation.findOneAndUpdate = async (_filter, update) => {
    if (invitation.status !== 'pending') return null;
    Object.assign(invitation, update.$set);
    return invitation;
  };
  Project.findById = async () => project;
  Project.findOne = async () => null;
  ProjectMember.findOne = async () => membership;
  ProjectMember.create = async (doc) => {
    membershipCreates += 1;
    membership = { ...doc, project: project._id, user: invitee._id };
    return membership;
  };
  Notification.create = async (doc) => {
    notifications.push(doc);
    return doc;
  };

  return {
    invitation,
    invitee,
    leader,
    project,
    notifications,
    get membershipCreates() { return membershipCreates; },
    request: (user = invitee) => ({ params: { token: invitation.token }, user }),
  };
};

const invokeInvitationHandler = async (handler, req) => {
  let statusCode;
  let responseBody;
  let capturedError;
  await handler(req, {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  }, (error) => { capturedError = error; });
  return { statusCode, responseBody, error: capturedError };
};

test('cohort IDs derive from department, batch start year, and section', () => {
  assert.equal(getCohortId({ department: 'Information Technology', section: 'e', batch: '2023-2027' }), 'IT-2023-E');
  assert.equal(getCohortId({ department: 'Computer Science', section: 'Q', batch: '2023-2027' }), 'CSE-2023-Q');
  assert.equal(getCohortId({ department: 'Computer Science', section: 'Q' }), null);
  assert.equal(getCohortId({ department: 'Computer Science', section: 'Q', batch: '2027-2023' }), null);
});

test('student search returns only students in the project cohort', async () => {
  await withPatchedModels(async () => {
    const leader = {
      _id: 'leader-id',
      id: 'leader-id',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const project = {
      _id: 'project-1',
      leader: 'leader-id',
      status: 'proposal_created',
      cohortId: 'IT-2023-E',
      teamMembers: ['leader-id'],
    };
    const students = [{ _id: 'student-e', name: 'Student E', section: 'E' }];
    Project.findById = async () => project;
    User.find = (filter) => {
      assert.equal(filter.cohortId, 'IT-2023-E');
      assert.deepEqual(filter._id.$nin, ['leader-id', 'leader-id']);
      assert.equal(filter.$or.length, 4);
      return {
        select() { return this; },
        sort() { return this; },
        limit: async () => students,
      };
    };

    let responseBody;
    await invitationController.searchEligibleStudents({
      query: { projectId: project._id, query: '23EG' },
      user: leader,
    }, {
      status() { return this; },
      json(body) { responseBody = body; return this; },
    }, (error) => { throw error; });

    assert.deepEqual(responseBody.students, students);
  });
});

test('student search distinguishes ineligible students from missing results', async () => {
  await withPatchedModels(async () => {
    const leader = {
      _id: 'leader-id',
      id: 'leader-id',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const project = {
      _id: 'project-1',
      leader: 'leader-id',
      status: 'proposal_created',
      cohortId: 'IT-2023-E',
      teamMembers: ['leader-id'],
    };

    const otherCohortStudent = {
      _id: 'student-d',
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
      rollNumber: '23EG112D07',
      department: 'Information Technology',
      section: 'D',
      batch: '2023-2027',
      cohortId: 'IT-2023-D',
    };

    Project.findById = async () => project;
    User.find = async () => [otherCohortStudent];

    let responseBody;
    await invitationController.searchEligibleStudents({
      query: { projectId: project._id, query: '23EG112D07' },
      user: leader,
    }, {
      status() { return this; },
      json(body) { responseBody = body; return this; },
    }, (error) => { throw error; });

    assert.deepEqual(responseBody.students, []);
    assert.equal(responseBody.ineligibleStudents.length, 1);
    assert.match(responseBody.ineligibleStudents[0].reason, /IT-D/i);
    assert.match(responseBody.ineligibleStudents[0].reason, /IT-E/i);
  });
});

test('sendInvitation allows team invites while project is still in proposal_created stage', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-1',
      leader: 'leader-id',
      status: 'proposal_created',
      title: 'ML Portal',
      cohortId: 'IT-2023-E',
      deadline: { _id: 'deadline-1' },
      teamMembers: ['leader-id'],
    };

    const invitee = {
      _id: 'student-2',
      email: 'student2@example.com',
      role: 'student',
      name: 'Student Two',
      rollNumber: '23EG9999',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };

    Project.findById = async () => project;
    User.findOne = async () => invitee;
    TeamInvitation.findOne = async () => null;
    ProjectMember.findOne = async () => null;
    TeamInvitation.create = async (doc) => ({
      ...doc,
      populate: async () => {},
      _id: 'inv-1',
      invitedUser: invitee,
      save: async function () { return this; },
    });
    Notification.create = async () => ({ ok: true });

    let statusCode;
    let responseBody;
    const req = {
      body: { projectId: 'project-1', studentIdentifier: 'student2@example.com' },
      user: {
        id: 'leader-id',
        name: 'Leader One',
        department: 'Information Technology',
        section: 'E',
        batch: '2023-2027',
      },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; return this; },
    };

    await invitationController.sendInvitation(req, res, (err) => {
      throw err;
    });

    assert.equal(statusCode, 201);
    assert.equal(responseBody.message, 'Invitation created. Resend accepted the email request.');
    assert.equal(responseBody.invitation.status, 'pending');
  });
});

test('sendInvitation preserves the saved invitation when Resend email is skipped', async () => {
  await withPatchedModels(async () => {
    const leader = {
      id: 'leader-id',
      name: 'Leader One',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const result = await exerciseSendInvitation({
      leader,
      invitee: {
        _id: 'student-2',
        email: 'student2@example.com',
        role: 'student',
        name: 'Student Two',
        department: 'Information Technology',
        section: 'E',
        batch: '2023-2027',
      },
      emailResult: { status: 'skipped' },
    });

    assert.equal(result.statusCode, 201);
    assert.equal(result.responseBody.invitationStatus, 'pending');
    assert.equal(result.responseBody.invitation.status, 'pending');
    assert.equal(result.responseBody.emailStatus, 'skipped');
    assert.match(result.responseBody.message, /invitation created.*email sending was skipped/i);
  });
});

test('a duplicate pending invitation is rejected without retrying its email', async () => {
  await withPatchedModels(async () => {
    const leader = {
      id: 'leader-id',
      name: 'Leader One',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const invitee = {
      _id: 'student-2',
      email: 'student2@example.com',
      role: 'student',
      name: 'Student Two',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const existingInvitation = {
      _id: 'inv-existing',
      token: 'existing-token',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86400000),
      emailStatus: 'failed',
      save: async function () { return this; },
      populate() { return this; },
    };

    const result = await exerciseSendInvitation({
      leader,
      invitee,
      existingInvitation,
      emailResult: { status: 'accepted_by_resend', id: 'resend-retry-id' },
    });

    assert.equal(result.error.statusCode, 409);
    assert.match(result.error.message, /invitation is already pending for this student/i);
    assert.equal(existingInvitation.emailStatus, 'failed');
    assert.equal(result.emailDetails, undefined);
    assert.equal(result.notificationCreates, 0);
  });
});

test('an expired pending record remains history and does not block a new invitation', async () => {
  await withPatchedModels(async () => {
    const leader = {
      id: 'leader-id',
      name: 'Leader One',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const invitee = {
      _id: 'student-2',
      email: 'student2@example.com',
      role: 'student',
      name: 'Student Two',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const expiredInvitation = {
      status: 'pending',
      expiresAt: new Date(Date.now() - 86400000),
    };

    const result = await exerciseSendInvitation({ leader, invitee, existingInvitation: expiredInvitation });

    assert.equal(result.statusCode, 201);
    assert.equal(expiredInvitation.status, 'pending');
    assert.equal(result.responseBody.invitation.status, 'pending');
    assert.equal(result.notificationCreates, 1);
  });
});

test('sendInvitation rejects a student from a different cohort with a useful message', async () => {
  await withPatchedModels(async () => {
    Project.findById = async () => ({
      _id: 'project-1',
      leader: 'leader-id',
      status: 'proposal_created',
      cohortId: 'IT-2023-E',
      teamMembers: ['leader-id'],
    });
    User.findOne = async () => ({
      _id: 'student-d',
      email: 'studentd@example.com',
      role: 'student',
      department: 'Information Technology',
      section: 'D',
      batch: '2023-2027',
    });

    const req = {
      body: { projectId: 'project-1', studentIdentifier: 'studentd@example.com' },
      user: {
        id: 'leader-id',
        department: 'Information Technology',
        section: 'E',
        batch: '2023-2027',
      },
    };
    let capturedError;
    await invitationController.sendInvitation(req, {}, (error) => {
      capturedError = error;
    });

    assert.equal(capturedError.statusCode, 403);
    assert.match(capturedError.message, /student belongs to IT-D/i);
    assert.match(capturedError.message, /same cohort \(IT-E/i);
  });
});

test('CSE-Q can invite CSE-Q and rejects CSE-B and IT-E students', async () => {
  await withPatchedModels(async () => {
    const leader = {
      id: 'cse-q-leader',
      department: 'Computer Science',
      section: 'Q',
      batch: '2023-2027',
    };
    const sameCohort = await exerciseSendInvitation({
      leader,
      invitee: {
        _id: 'cse-q-member',
        email: 'member@example.com',
        role: 'student',
        department: 'Computer Science',
        section: 'Q',
        batch: '2023-2027',
      },
    });
    assert.equal(sameCohort.statusCode, 201);
    assert.equal(sameCohort.error, undefined);

    for (const candidate of [
      { department: 'Computer Science', section: 'B', expected: 'CSE-B' },
      { department: 'Information Technology', section: 'E', expected: 'IT-E' },
    ]) {
      const result = await exerciseSendInvitation({
        leader,
        invitee: {
          _id: `student-${candidate.section}`,
          email: `student-${candidate.section}@example.com`,
          role: 'student',
          department: candidate.department,
          section: candidate.section,
          batch: '2023-2027',
        },
      });
      assert.equal(result.error.statusCode, 403);
      assert.match(result.error.message, new RegExp(candidate.expected));
    }
  });
});

test('sendInvitation preserves self, team-member, duplicate, committed-project, and not-found rules', async () => {
  await withPatchedModels(async () => {
    const leader = {
      id: 'leader-id',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const student = {
      _id: 'student-2',
      email: 'student2@example.com',
      role: 'student',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };

    const selfResult = await exerciseSendInvitation({
      leader,
      invitee: { ...student, _id: leader.id, email: 'leader@example.com' },
    });
    assert.equal(selfResult.error.statusCode, 400);
    assert.match(selfResult.error.message, /cannot invite yourself/i);

    const memberResult = await exerciseSendInvitation({ leader, invitee: student, teamMemberIds: [student._id] });
    assert.equal(memberResult.error.statusCode, 409);

    const duplicateResult = await exerciseSendInvitation({
      leader,
      invitee: student,
      existingInvitation: { status: 'pending', expiresAt: new Date(Date.now() + 86400000) },
    });
    assert.equal(duplicateResult.error.statusCode, 409);
    assert.match(duplicateResult.error.message, /invitation is already pending for this student/i);

    const committedResult = await exerciseSendInvitation({
      leader,
      invitee: student,
      existingMembership: { project: 'other-project' },
      otherProject: { _id: 'other-project', deadline: 'deadline-1' },
    });
    assert.equal(committedResult.error.statusCode, 409);
    assert.match(committedResult.error.message, /already part of another project/i);

    const missingResult = await exerciseSendInvitation({ leader, invitee: null });
    assert.equal(missingResult.error.statusCode, 404);
    assert.match(missingResult.error.message, /no matching student/i);
  });
});

test('sendInvitation explains why a proposal in faculty review cannot receive new invitations', async () => {
  await withPatchedModels(async () => {
    const leader = {
      id: 'leader-id',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const invitee = {
      _id: 'student-2',
      email: 'student2@example.com',
      role: 'student',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };
    const result = await exerciseSendInvitation({ leader, invitee, projectStatus: 'faculty_review' });
    assert.equal(result.error.statusCode, 400);
    assert.match(result.error.message, /with faculty for review/i);
    assert.match(result.error.message, /draft or an unsubmitted proposal/i);
  });
});

test('acceptInvitation records acceptedAt and adds the student to the project team', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: 'project-1',
      title: 'ML Portal',
      status: 'proposal_created',
      cohortId: 'IT-2023-E',
      teamMembers: ['leader-id'],
    };
    const inviter = { _id: 'leader-id', name: 'Leader One', email: 'leader@example.com' };
    const invitee = {
      _id: 'student-2',
      name: 'Student Two',
      department: 'Information Technology',
      section: 'E',
      batch: '2023-2027',
    };

    const invitation = {
      _id: 'inv-1',
      token: 'token-123',
      status: 'pending',
      expiresAt: new Date(Date.now() + 86400000),
      invitedUser: { toString: () => 'student-2' },
      invitedBy: inviter,
      project,
      save: async function () {
        this.status = 'accepted';
        this.acceptedAt = new Date();
        return this;
      },
      populate() {
        return this;
      },
    };

    TeamInvitation.findOne = () => invitation;
    TeamInvitation.findOneAndUpdate = async (_filter, update) => {
      Object.assign(invitation, update.$set);
      return invitation;
    };
    Project.findById = async () => project;
    Project.findByIdAndUpdate = async () => ({ ok: true });
    ProjectMember.findOne = async () => null;
    ProjectMember.create = async () => ({ ok: true });
    Notification.create = async () => ({ ok: true });

    let statusCode;
    let responseBody;
    const req = {
      params: { token: 'token-123' },
      user: {
        id: 'student-2',
        name: 'Student Two',
        department: 'Information Technology',
        section: 'E',
        batch: '2023-2027',
      },
    };
    const res = {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; return this; },
    };

    await invitationController.acceptInvitation(req, res, (err) => {
      throw err;
    });

    assert.equal(statusCode, 200);
    assert.equal(responseBody.message, 'Invitation accepted. You are now a team member.');
    assert.equal(invitation.status, 'accepted');
    assert.ok(invitation.acceptedAt instanceof Date);
  });
});

test('received invitation listing populates project and inviter details', async () => {
  await withPatchedModels(async () => {
    const invitation = {
      _id: 'inv-received',
      project: { title: 'ML Portal', description: 'Project description', status: 'proposal_created' },
      invitedBy: { name: 'Leader One', email: 'leader@example.com', rollNumber: 'LEADER-1' },
      status: 'pending',
      expiresAt: new Date(Date.now() + 86400000),
    };
    const populated = [];
    TeamInvitation.find = (filter) => {
      assert.deepEqual(filter, { invitedUser: 'student-2' });
      return {
        populate(path, fields) { populated.push({ path, fields }); return this; },
        sort() { return Promise.resolve([invitation]); },
      };
    };

    const result = await invokeInvitationHandler(invitationController.getMyInvitations, { user: { id: 'student-2' } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.responseBody.invitations[0].project.title, 'ML Portal');
    assert.equal(result.responseBody.invitations[0].invitedBy.name, 'Leader One');
    assert.equal(result.responseBody.invitations[0].invitedBy.email, 'leader@example.com');
    assert.equal(result.responseBody.invitations[0].invitedBy.rollNumber, 'LEADER-1');
    assert.equal(result.responseBody.invitations[0].status, 'pending');
    assert.equal(populated.length, 2);
  });
});

test('leader invitation listing populates project and invitee details', async () => {
  await withPatchedModels(async () => {
    const invitation = {
      _id: 'inv-sent',
      project: { title: 'ML Portal', status: 'proposal_created' },
      invitedUser: { name: 'Student Two', email: 'student2@example.com', rollNumber: '23IT0002' },
      status: 'pending',
    };
    TeamInvitation.find = (filter) => {
      assert.deepEqual(filter, { invitedBy: 'leader-id' });
      return {
        populate() { return this; },
        sort() { return Promise.resolve([invitation]); },
      };
    };

    const result = await invokeInvitationHandler(invitationController.getLeaderInvitations, { user: { id: 'leader-id' } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.responseBody.invitations[0].project.title, 'ML Portal');
    assert.equal(result.responseBody.invitations[0].invitedUser.email, 'student2@example.com');
    assert.equal(result.responseBody.invitations[0].invitedUser.rollNumber, '23IT0002');
  });
});

test('received and leader invitation listings do not mutate overdue pending records', async () => {
  await withPatchedModels(async () => {
    let saved = 0;
    const invitation = {
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000),
      async save() { saved += 1; },
    };
    TeamInvitation.find = () => ({
      populate() { return this; },
      sort() { return Promise.resolve([invitation]); },
    });

    const received = await invokeInvitationHandler(invitationController.getMyInvitations, { user: { id: 'student-2' } });
    const sent = await invokeInvitationHandler(invitationController.getLeaderInvitations, { user: { id: 'leader-id' } });
    assert.equal(received.statusCode, 200);
    assert.equal(sent.statusCode, 200);
    assert.equal(received.responseBody.invitations[0].status, 'pending');
    assert.equal(sent.responseBody.invitations[0].status, 'pending');
    assert.equal(saved, 0);
  });
});

test('acceptance notifies the leader and sends registered student details', async () => {
  await withPatchedModels(async () => {
    const fixture = createInvitationFixture();
    let emailDetails;
    let emailAttempts = 0;
    emailService.sendTeamMemberAcceptedEmail = async (details) => {
      emailAttempts += 1;
      emailDetails = details;
      return true;
    };

    const result = await invokeInvitationHandler(invitationController.acceptInvitation, fixture.request());
    assert.equal(result.statusCode, 200);
    assert.equal(result.responseBody.invitationStatus, 'accepted');
    assert.equal(result.responseBody.emailStatus, 'accepted_by_resend');
    assert.equal(fixture.invitation.acceptedEmailStatus, 'accepted_by_resend');
    assert.equal(fixture.notifications.length, 1);
    assert.equal(fixture.notifications[0].recipient, fixture.leader._id);
    assert.equal(fixture.notifications[0].relatedProject, fixture.project._id);
    assert.equal(emailDetails.recipientEmail, fixture.leader.email);
    assert.equal(emailDetails.teamMemberEmail, fixture.invitee.email);
    assert.equal(emailDetails.rollNumber, fixture.invitee.rollNumber);
    assert.equal(emailDetails.projectTitle, fixture.project.title);
    assert.ok(emailDetails.occurredAt instanceof Date);

    const repeated = await invokeInvitationHandler(invitationController.acceptInvitation, fixture.request());
    assert.equal(repeated.responseBody.invitationStatus, 'accepted');
    assert.equal(emailAttempts, 1);
    assert.equal(fixture.notifications.length, 1);
  });
});

test('acceptance remains successful when email fails and retry does not repeat membership or notification', async () => {
  await withPatchedModels(async () => {
    const fixture = createInvitationFixture();
    let emailAttempts = 0;
    emailService.sendTeamMemberAcceptedEmail = async () => {
      emailAttempts += 1;
      return emailAttempts > 1;
    };

    const firstResult = await invokeInvitationHandler(invitationController.acceptInvitation, fixture.request());
    assert.equal(firstResult.statusCode, 200);
    assert.equal(firstResult.responseBody.invitationStatus, 'accepted');
    assert.equal(firstResult.responseBody.emailStatus, 'failed');
    assert.equal(fixture.invitation.acceptedEmailStatus, 'failed');

    const retryResult = await invokeInvitationHandler(invitationController.acceptInvitation, fixture.request());
    assert.equal(retryResult.statusCode, 200);
    assert.equal(retryResult.responseBody.emailStatus, 'accepted_by_resend');
    assert.equal(fixture.membershipCreates, 1);
    assert.equal(fixture.notifications.length, 1);
    assert.equal(emailAttempts, 2);
  });
});

test('acceptance rejects another student and expires old invitations', async () => {
  await withPatchedModels(async () => {
    const wrongStudentFixture = createInvitationFixture();
    const wrongStudent = { ...wrongStudentFixture.invitee, id: 'student-3' };
    const unauthorized = await invokeInvitationHandler(
      invitationController.acceptInvitation,
      wrongStudentFixture.request(wrongStudent),
    );
    assert.equal(unauthorized.error.statusCode, 403);
    assert.equal(wrongStudentFixture.membershipCreates, 0);

    const expiredFixture = createInvitationFixture({ expiresAt: new Date(Date.now() - 1000) });
    const expired = await invokeInvitationHandler(invitationController.acceptInvitation, expiredFixture.request());
    assert.equal(expired.error.statusCode, 400);
    assert.equal(expiredFixture.invitation.status, 'expired');
    assert.equal(expiredFixture.membershipCreates, 0);
    assert.equal(expiredFixture.notifications.length, 0);
  });
});

test('acceptance does not create a duplicate team membership', async () => {
  await withPatchedModels(async () => {
    const fixture = createInvitationFixture({ memberExists: true });
    const result = await invokeInvitationHandler(invitationController.acceptInvitation, fixture.request());
    assert.equal(result.statusCode, 200);
    assert.equal(fixture.membershipCreates, 0);
    assert.equal(fixture.project.teamMembers.filter((member) => member === fixture.invitee._id).length, 1);
  });
});

test('rejection validates expiry, notifies the leader, and sends a decline email once', async () => {
  await withPatchedModels(async () => {
    const fixture = createInvitationFixture();
    let emailAttempts = 0;
    let emailDetails;
    emailService.sendTeamMemberRejectedEmail = async (details) => {
      emailAttempts += 1;
      emailDetails = details;
      return true;
    };

    const result = await invokeInvitationHandler(invitationController.rejectInvitation, fixture.request());
    assert.equal(result.statusCode, 200);
    assert.equal(result.responseBody.invitationStatus, 'rejected');
    assert.equal(result.responseBody.emailStatus, 'accepted_by_resend');
    assert.equal(fixture.invitation.rejectedEmailStatus, 'accepted_by_resend');
    assert.equal(fixture.notifications.length, 1);
    assert.equal(fixture.notifications[0].type, 'invitation_rejected');
    assert.equal(fixture.notifications[0].recipient, fixture.leader._id);
    assert.equal(fixture.membershipCreates, 0);
    assert.equal(emailDetails.teamMemberName, fixture.invitee.name);
    assert.equal(emailDetails.rollNumber, fixture.invitee.rollNumber);
    assert.ok(emailDetails.occurredAt instanceof Date);

    const repeated = await invokeInvitationHandler(invitationController.rejectInvitation, fixture.request());
    assert.equal(repeated.responseBody.invitationStatus, 'rejected');
    assert.equal(emailAttempts, 1);
    assert.equal(fixture.notifications.length, 1);
  });
});

test('rejection rejects another student and expires old invitations', async () => {
  await withPatchedModels(async () => {
    const wrongStudentFixture = createInvitationFixture();
    const wrongStudent = { ...wrongStudentFixture.invitee, id: 'student-3' };
    const unauthorized = await invokeInvitationHandler(
      invitationController.rejectInvitation,
      wrongStudentFixture.request(wrongStudent),
    );
    assert.equal(unauthorized.error.statusCode, 403);

    const expiredFixture = createInvitationFixture({ expiresAt: new Date(Date.now() - 1000) });
    const expired = await invokeInvitationHandler(invitationController.rejectInvitation, expiredFixture.request());
    assert.equal(expired.error.statusCode, 400);
    assert.equal(expiredFixture.invitation.status, 'expired');
    assert.equal(expiredFixture.notifications.length, 0);
  });
});
