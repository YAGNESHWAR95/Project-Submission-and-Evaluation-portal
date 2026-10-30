const test = require('node:test');
const assert = require('node:assert/strict');

const Deadline = require('../src/models/Deadline');
const deadlineController = require('../src/controllers/deadlineController');
const projectController = require('../src/controllers/projectController');

const originalFindById = Deadline.findById;
const originalCreate = Deadline.create;
const originalUpdateMany = Deadline.updateMany;

const withPatchedDeadline = async (patches, run) => {
  const originals = patches.map(([method, replacement]) => {
    const original = Deadline[method];
    Deadline[method] = replacement;
    return [method, original];
  });
  try {
    await run();
  } finally {
    originals.forEach(([method, original]) => { Deadline[method] = original; });
  }
};

const makeResponse = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test.after(() => {
  Deadline.findById = originalFindById;
  Deadline.create = originalCreate;
  Deadline.updateMany = originalUpdateMany;
});

test('deadline creation rejects invalid dates before deactivating existing deadlines', async () => {
  await withPatchedDeadline([
    ['updateMany', async () => assert.fail('invalid deadline must not deactivate records')],
    ['create', async () => assert.fail('invalid deadline must not be created')],
  ], async () => {
    let error;
    await deadlineController.createDeadline({
      body: {
        batch: 'Batch 2027',
        title: 'Future deadline',
        submissionStartDate: 'not-a-date',
        submissionEndDate: '2099-01-01',
      },
    }, makeResponse(), (nextError) => { error = nextError; });

    assert.equal(error.statusCode, 400);
    assert.match(error.message, /valid submission/i);
  });
});

test('inactive deadline can be rescheduled and reopened with an explicit update', async () => {
  const deadline = {
    _id: 'deadline-1',
    batch: 'Batch 2027',
    title: 'Early Review',
    submissionStartDate: new Date('2098-01-01'),
    submissionEndDate: new Date('2098-01-20'),
    isActive: false,
    save: async function () { return this; },
  };
  let deactivatedFilter;
  await withPatchedDeadline([
    ['findById', async () => deadline],
    ['updateMany', async (filter) => { deactivatedFilter = filter; }],
  ], async () => {
    const response = makeResponse();
    await deadlineController.updateDeadline({
      params: { id: deadline._id },
      body: {
        batch: 'Batch 2027',
        title: 'Early Review Rescheduled',
        submissionStartDate: '2099-01-01T00:00:00.000Z',
        submissionEndDate: '2099-01-20T00:00:00.000Z',
        isActive: true,
      },
    }, response, (error) => { throw error; });

    assert.equal(response.statusCode, 200);
    assert.equal(deadline.isActive, true);
    assert.equal(deadline.title, 'Early Review Rescheduled');
    assert.equal(String(deactivatedFilter._id.$ne), deadline._id);
  });
});

test('expired inactive deadline cannot reopen until its cutoff is rescheduled', async () => {
  const deadline = {
    _id: 'deadline-2',
    batch: 'Batch 2026',
    title: 'Expired Window',
    submissionStartDate: new Date('2020-01-01'),
    submissionEndDate: new Date('2020-01-20'),
    isActive: false,
    save: async () => assert.fail('expired deadline must not reopen'),
  };
  await withPatchedDeadline([
    ['findById', async () => deadline],
    ['updateMany', async () => assert.fail('expired deadline must not reopen')],
  ], async () => {
    let error;
    await deadlineController.updateDeadline({
      params: { id: deadline._id },
      body: { isActive: true },
    }, makeResponse(), (nextError) => { error = nextError; });

    assert.equal(error.statusCode, 400);
    assert.match(error.message, /reschedule the cutoff/i);
  });
});

test('student deadlines are scoped to the active batch for that learner', async () => {
  const requestedBatch = 'Batch 2027';
  const deadlines = [
    { _id: 'd-1', batch: 'Batch 2026', isActive: true, submissionEndDate: '2026-12-31T00:00:00.000Z' },
    { _id: 'd-2', batch: requestedBatch, isActive: true, submissionEndDate: '2027-12-31T00:00:00.000Z' },
    { _id: 'd-3', batch: 'Batch 2028', isActive: true, submissionEndDate: '2028-12-31T00:00:00.000Z' },
  ];

  const originalFind = Deadline.find;
  Deadline.find = (filter) => {
    assert.equal(filter.isActive, true);
    assert.ok(filter.batch.$in.includes(requestedBatch));
    return {
      sort: () => deadlines.filter((deadline) => filter.batch.$in.includes(deadline.batch)),
    };
  };

  try {
    const response = makeResponse();
    await projectController.getStudentDeadlines({ user: { batch: requestedBatch }, query: {} }, response, () => {
      throw new Error('expected no error');
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.deadlines.map((d) => d._id), ['d-2']);
  } finally {
    Deadline.find = originalFind;
  }
});

test('deadline activation is independent for each cohort phase', async () => {
  const deactivatedFilters = [];
  const created = [];
  await withPatchedDeadline([
    ['updateMany', async (filter) => { deactivatedFilters.push(filter); }],
    ['create', async (data) => { created.push(data); return data; }],
  ], async () => {
    for (const phase of ['abstract', 'midterm', 'final']) {
      const response = makeResponse();
      await deadlineController.createDeadline({
        body: {
          batch: 'Batch 2026',
          phase,
          title: `${phase} window`,
          submissionStartDate: '2099-01-01T00:00:00.000Z',
          submissionEndDate: '2099-01-20T00:00:00.000Z',
        },
      }, response, (error) => { throw error; });
      assert.equal(response.statusCode, 201);
    }
  });

  assert.deepEqual(deactivatedFilters.map(({ batch, phase }) => ({ batch, phase })), [
    { batch: 'Batch 2026', phase: 'abstract' },
    { batch: 'Batch 2026', phase: 'midterm' },
    { batch: 'Batch 2026', phase: 'final' },
  ]);
  assert.deepEqual(created.map((deadline) => deadline.phase), ['abstract', 'midterm', 'final']);
});