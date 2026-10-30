const test = require('node:test');
const assert = require('node:assert/strict');
const Notification = require('../src/models/Notification');
const notificationController = require('../src/controllers/notificationController');

const originalDeleteMany = Notification.deleteMany;

test.after(() => {
  Notification.deleteMany = originalDeleteMany;
});

test('clearMyNotifications deletes only records for the authenticated recipient', async () => {
  Notification.deleteMany = async (filter) => {
    assert.deepEqual(filter, { recipient: 'student-1' });
    return { deletedCount: 3 };
  };

  let statusCode;
  let body;
  await notificationController.clearMyNotifications({ user: { id: 'student-1' } }, {
    status(code) { statusCode = code; return this; },
    json(value) { body = value; return this; },
  }, (error) => { throw error; });

  assert.equal(statusCode, 200);
  assert.equal(body.deletedCount, 3);
});