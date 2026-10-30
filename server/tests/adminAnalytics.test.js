const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../src/models/User');
const Project = require('../src/models/Project');
const Evaluation = require('../src/models/Evaluation');
const adminController = require('../src/controllers/adminController');

const withPatchedMethods = async (patches, run) => {
  const originals = patches.map(([target, method, replacement]) => {
    const original = target[method];
    target[method] = replacement;
    return [target, method, original];
  });

  try {
    await run();
  } finally {
    originals.forEach(([target, method, original]) => {
      target[method] = original;
    });
  }
};

test('system analytics counts real lifecycle states and excludes proposals from assignment readiness', async () => {
  const statusCounts = [
    { _id: 'proposal_created', count: 2, assignedCount: 0 },
    { _id: 'draft', count: 1, assignedCount: 0 },
    { _id: 'uniqueness_checked', count: 2, assignedCount: 0 },
    { _id: 'submitted', count: 1, assignedCount: 0 },
    { _id: 'faculty_review', count: 1, assignedCount: 1 },
    { _id: 'under_review', count: 1, assignedCount: 1 },
    { _id: 'evaluated', count: 1, assignedCount: 1 },
    { _id: 'rejected', count: 1, assignedCount: 0 },
    { _id: 'withdrawn', count: 1, assignedCount: 0 },
  ];
  const patches = [
    [User, 'countDocuments', async ({ role }) => (role === 'student' ? 8 : 3)],
    [Project, 'aggregate', async (pipeline) => (
      pipeline[0].$match
        ? [{ department: 'Computer Science', submissions: 5 }]
        : statusCounts
    )],
    [Evaluation, 'find', async () => [{ totalScore: 80 }, { totalScore: 90 }]],
  ];

  await withPatchedMethods(patches, async () => {
    let response;
    const res = {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        response = body;
        return this;
      },
    };

    await adminController.getSystemStats({}, res, (error) => {
      throw error;
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(response.data.summary, {
      totalStudents: 8,
      totalFaculty: 3,
      totalProjects: 11,
      proposalProjects: 3,
      awaitingFacultyAssignment: 3,
      assignedProjects: 3,
      facultyReviewProjects: 2,
      evaluatedProjects: 1,
      averageScore: '85.0',
    });
    assert.deepEqual(response.data.statusStats.map(({ name, value }) => [name, value]), [
      ['Proposals & Drafts', 3],
      ['Awaiting Faculty Assignment', 3],
      ['Faculty Review', 2],
      ['Evaluated', 1],
      ['Closed', 2],
    ]);
    assert.deepEqual(response.data.deptStats, [{ department: 'Computer Science', submissions: 5 }]);
  });
});

test('admin student edits validate cohort details, preserve role, and omit password from response', async () => {
  const student = {
    _id: 'student-1',
    role: 'student',
    save: async function () { return this; },
    toObject() {
      return { _id: this._id, role: this.role, name: this.name, email: this.email, password: 'hash' };
    },
  };
  const patches = [
    [User, 'findById', async () => student],
    [User, 'findOne', async () => null],
  ];

  await withPatchedMethods(patches, async () => {
    let response;
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { response = body; return this; },
    };
    await adminController.updateStudentDetails({
      params: { id: student._id },
      body: {
        name: 'Student One',
        email: 'STUDENT@example.com',
        rollNumber: '23CS0001',
        department: 'Computer Science',
        section: 'q',
        batch: '2023-2027',
        academicYear: '2026-27',
      },
    }, res, (error) => { throw error; });

    assert.equal(res.statusCode, 200);
    assert.equal(student.name, 'Student One');
    assert.equal(student.email, 'student@example.com');
    assert.equal(student.section, 'Q');
    assert.equal(student.role, 'student');
    assert.equal(response.user.password, undefined);
  });
});

test('admin student edits reject reversed batch years', async () => {
  const student = {
    _id: 'student-1',
    role: 'student',
    save: async () => assert.fail('invalid cohort must not be saved'),
  };
  await withPatchedMethods([[User, 'findById', async () => student]], async () => {
    let error;
    await adminController.updateStudentDetails({
      params: { id: student._id },
      body: {
        name: 'Student One',
        email: 'student@example.com',
        rollNumber: '23CS0001',
        department: 'Computer Science',
        section: 'Q',
        batch: '2027-2023',
        academicYear: '2026-27',
      },
    }, { status() { return this; }, json() { return this; } }, (nextError) => { error = nextError; });

    assert.equal(error.statusCode, 400);
    assert.match(error.message, /valid batch/i);
  });
});