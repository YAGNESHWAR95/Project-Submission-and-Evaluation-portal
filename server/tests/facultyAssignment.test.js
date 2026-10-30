const test = require('node:test');
const assert = require('node:assert/strict');

const Project = require('../src/models/Project');
const ProjectMember = require('../src/models/ProjectMember');
const User = require('../src/models/User');
const Notification = require('../src/models/Notification');
const projectController = require('../src/controllers/projectController');

const originalProjectFindById = Project.findById;
const originalProjectCountDocuments = Project.countDocuments;
const originalUserFindById = User.findById;
const originalNotificationCreate = Notification.create;
const originalNotificationUpdateOne = Notification.updateOne;
const originalProjectMemberFind = ProjectMember.find;
const originalNodeEnv = process.env.NODE_ENV;

const withPatchedModels = async (run) => {
  try {
    process.env.NODE_ENV = 'test';
    await run();
  } finally {
    Project.findById = originalProjectFindById;
    Project.countDocuments = originalProjectCountDocuments;
    User.findById = originalUserFindById;
    Notification.create = originalNotificationCreate;
    Notification.updateOne = originalNotificationUpdateOne;
    ProjectMember.find = originalProjectMemberFind;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
};

const makeResponse = () => ({
  statusCode: null,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('faculty assignment rejects proposals before loading or changing faculty', async () => {
  await withPatchedModels(async () => {
    const project = {
      _id: '507f1f77bcf86cd799439021',
      status: 'proposal_created',
      save: async () => assert.fail('ineligible project must not be saved'),
    };
    Project.findById = () => ({ then: (resolve) => resolve(project) });
    User.findById = async () => assert.fail('ineligible project must not load faculty');

    let error;
    await projectController.assignFacultyToProject(
      { params: { id: '507f1f77bcf86cd799439021' }, body: { facultyId: '507f1f77bcf86cd799439022' }, user: { id: '507f1f77bcf86cd799439023' } },
      makeResponse(),
      (nextError) => { error = nextError; },
    );

    assert.equal(error.statusCode, 400);
    assert.match(error.message, /not ready for faculty assignment/i);
  });
});

test('eligible assignment uses actual workload and saves the faculty assignment', async () => {
  await withPatchedModels(async () => {
    const faculty = {
      _id: '507f1f77bcf86cd799439013',
      name: 'Faculty One',
      email: 'faculty@example.com',
      role: 'faculty',
      department: 'Computer Science',
      availability: 'available',
      facultyProfile: { maxProjects: 4, currentProjects: 99 },
    };
    const leader = { _id: '507f1f77bcf86cd799439011', name: 'Leader One', department: 'Computer Science' };
    const project = {
      _id: '507f1f77bcf86cd799439021',
      title: 'Submission Portal',
      status: 'submitted',
      department: 'Computer Science',
      leader: leader._id,
      teamMembers: ['507f1f77bcf86cd799439012'],
      save: async function () { return this; },
    };
    let workloadFilter;
    const notificationKeys = new Set();
    Project.findById = () => ({
      populate() { return this; },
      then(resolve, reject) { return Promise.resolve(project).then(resolve, reject); },
    });
    Project.countDocuments = async (filter) => {
      workloadFilter = filter;
      return 2;
    };
    User.findById = async (id) => (String(id) === faculty._id ? faculty : leader);
    Notification.updateOne = async (filter) => {
      notificationKeys.add([filter.recipient, filter.title, filter.message].join(':'));
      return { ok: true };
    };
    ProjectMember.find = () => ({
      select: async () => [{ user: leader._id }, { user: '507f1f77bcf86cd799439012' }],
    });

    const request = { params: { id: project._id }, body: { facultyId: faculty._id }, user: { id: '507f1f77bcf86cd799439014' } };
    const response = makeResponse();
    await projectController.assignFacultyToProject(
      request,
      response,
      (error) => { throw error; },
    );

    assert.equal(response.statusCode, 200);
    assert.equal(project.assignedFaculty, faculty._id);
    assert.equal(project.status, 'faculty_review');
    assert.deepEqual(workloadFilter, { assignedFaculty: faculty._id });
    assert.equal(notificationKeys.size, 3);
    const teamMessages = [...notificationKeys].filter((notification) => notification.includes('Faculty Guide Assigned'));
    assert.equal(teamMessages.length, 2);
    assert.ok(teamMessages.every((notification) => notification.includes(project.title)));
    assert.ok(teamMessages.every((notification) => notification.includes(faculty.name)));
    assert.ok(teamMessages.every((notification) => notification.includes('Next steps')));

    await projectController.assignFacultyToProject(
      request,
      makeResponse(),
      (error) => { throw error; },
    );
    assert.equal(notificationKeys.size, 3);
  });
});

test('assignment notifications ignore invalid recipients and keep deduped leader/member alerts', async () => {
  await withPatchedModels(async () => {
    const faculty = {
      _id: '507f1f77bcf86cd799439013',
      name: 'Faculty One',
      email: 'faculty@example.com',
      role: 'faculty',
      department: 'Computer Science',
      availability: 'available',
      facultyProfile: { maxProjects: 4 },
    };
    const leader = { _id: '507f1f77bcf86cd799439011', name: 'Leader One', department: 'Computer Science' };
    const validMember = { _id: '507f1f77bcf86cd799439012', name: 'Member One' };
    const project = {
      _id: '507f1f77bcf86cd799439021',
      title: 'Team Portal',
      status: 'submitted',
      department: 'Computer Science',
      leader: leader._id,
      teamMembers: ['bad-id', validMember._id],
      save: async function () { return this; },
    };

    const notificationCalls = [];
    Project.findById = () => ({
      populate() { return this; },
      then(resolve, reject) { return Promise.resolve(project).then(resolve, reject); },
    });
    Project.countDocuments = async () => 0;
    User.findById = async (id) => {
      if (String(id) === faculty._id) return faculty;
      if (String(id) === leader._id) return leader;
      return null;
    };
    Notification.updateOne = async (filter) => {
      notificationCalls.push(filter);
      return { ok: true };
    };
    ProjectMember.find = () => ({
      select: async () => [{ user: leader._id }, { user: validMember._id }],
    });

    const request = { params: { id: project._id }, body: { facultyId: faculty._id }, user: { id: '507f1f77bcf86cd799439014' } };
    await projectController.assignFacultyToProject(request, makeResponse(), (error) => { throw error; });

    const recipients = notificationCalls.map((call) => String(call.recipient));
    assert.ok(recipients.includes(String(leader._id)));
    assert.ok(recipients.includes(String(validMember._id)));
    assert.ok(!recipients.includes('bad-id'));
    assert.equal(new Set(recipients).size, recipients.length);

    await projectController.assignFacultyToProject(request, makeResponse(), (error) => { throw error; });
    const uniqueNotificationKeys = new Set(
      notificationCalls.map((call) => `${call.recipient}:${call.title}:${call.message}`),
    );
    assert.equal(uniqueNotificationKeys.size, 3);
  });
});