const test = require('node:test');
const assert = require('node:assert/strict');

const emailService = require('../src/services/emailService');
const logger = require('../src/utils/logger');

const envKeys = ['NODE_ENV', 'RESEND_API_KEY', 'EMAIL_FROM', 'CLIENT_URL'];
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = global.fetch;
const originalLoggerError = logger.error;

test.afterEach(() => {
  envKeys.forEach((key) => {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  });
  global.fetch = originalFetch;
  logger.error = originalLoggerError;
});

const setEmailConfig = () => {
  process.env.NODE_ENV = 'development';
  process.env.RESEND_API_KEY = 're_test_only_do_not_use';
  process.env.EMAIL_FROM = 'Portal <onboarding@example.com>';
  process.env.CLIENT_URL = 'https://portal.example.com';
};

test('team invitation email skips Resend when required configuration is missing', async () => {
  setEmailConfig();
  process.env.RESEND_API_KEY = '';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('Unexpected Resend request');
  };

  const result = await emailService.sendTeamInvitationEmail({
    recipientEmail: 'student@example.com',
    token: 'invitation-token',
    projectTitle: 'Test Project',
  });

  assert.deepEqual(result, { status: 'skipped' });
  assert.equal(fetchCalled, false);
});

test('team invitation email skips Resend when the sender is missing', async () => {
  setEmailConfig();
  process.env.EMAIL_FROM = ' ';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('Unexpected Resend request');
  };

  const result = await emailService.sendTeamInvitationEmail({
    recipientEmail: 'student@example.com',
    token: 'invitation-token',
    projectTitle: 'Test Project',
  });

  assert.deepEqual(result, { status: 'skipped' });
  assert.equal(fetchCalled, false);
});

test('team invitation email reports success for a mocked Resend send', async () => {
  setEmailConfig();
  let request;
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ id: 'mock-resend-email-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await emailService.sendTeamInvitationEmail({
    recipientEmail: 'student@example.com',
    recipientName: 'Student',
    inviterName: 'Leader',
    projectTitle: 'Test Project',
    token: 'invitation-token',
    invitationId: 'invitation-123',
  });

  assert.equal(result.status, 'accepted_by_resend');
  assert.equal(result.id, 'mock-resend-email-id');
  assert.match(request.url, /api\.resend\.com\/emails$/);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.body.from, 'Portal <onboarding@example.com>');
  assert.deepEqual(request.body.to, ['student@example.com']);
  assert.equal(request.body.subject, "You've been invited to join Test Project");
  assert.match(request.body.text, /https:\/\/portal\.example\.com\/team-invitations\/invitation-token/);
  assert.equal(new Headers(request.options.headers).get('Idempotency-Key'), 'evalportal-invitation-created-invitation-123');
});

test('invitation retry reuses its idempotency key and a new invitation gets an independent key', async () => {
  setEmailConfig();
  const requests = [];
  global.fetch = async (_url, options) => {
    requests.push({
      idempotencyKey: new Headers(options.headers).get('Idempotency-Key'),
      body: JSON.parse(options.body),
    });
    return new Response(JSON.stringify({ id: `mock-resend-${requests.length}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const invite = (invitationId) => emailService.sendTeamInvitationEmail({
    recipientEmail: 'student@example.com',
    projectTitle: 'Test Project',
    token: 'invitation-token',
    invitationId,
  });
  await invite('invitation-retry');
  await invite('invitation-retry');
  await invite('invitation-new');

  assert.equal(requests.length, 3);
  assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey);
  assert.notEqual(requests[1].idempotencyKey, requests[2].idempotencyKey);
});

test('team invitation email logs Resend errors without exposing the API key', async () => {
  setEmailConfig();
  const apiKey = process.env.RESEND_API_KEY;
  const errorLogs = [];
  logger.error = (message) => errorLogs.push(message);
  global.fetch = async () => new Response(JSON.stringify({
    statusCode: 401,
    message: `Invalid API key ${apiKey}`,
    name: 'validation_error',
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });

  const result = await emailService.sendTeamInvitationEmail({
    recipientEmail: 'student@example.com',
    projectTitle: 'Test Project',
    token: 'invitation-token',
  });

  assert.deepEqual(result, { status: 'failed' });
  assert.match(errorLogs[0], /Invalid API key \[REDACTED\]/);
  assert.equal(errorLogs.some((message) => message.includes(apiKey)), false);
});

test('acceptance and rejection acknowledgement emails use stable idempotency keys', async () => {
  setEmailConfig();
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({
      url,
      options,
      body: JSON.parse(options.body),
      idempotencyKey: new Headers(options.headers).get('Idempotency-Key'),
    });
    return new Response(JSON.stringify({ id: `mock-resend-${requests.length}` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const common = {
    recipientEmail: 'leader@example.com',
    leaderName: 'Leader One',
    projectTitle: 'Test Project',
    teamMemberName: 'Student Two',
    teamMemberEmail: 'student@example.com',
    rollNumber: '23IT0002',
    invitationId: 'invitation-123',
    occurredAt: new Date('2026-10-10T12:00:00.000Z'),
  };

  assert.equal((await emailService.sendTeamMemberAcceptedEmail(common)).status, 'accepted_by_resend');
  assert.equal((await emailService.sendTeamMemberRejectedEmail(common)).status, 'accepted_by_resend');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.to[0], 'leader@example.com');
  assert.match(requests[0].body.subject, /Accepted.*EvalPortal/);
  assert.match(requests[0].body.text, /Student email: student@example.com/);
  assert.match(requests[0].body.text, /Date and time \(UTC\): 2026-10-10T12:00:00.000Z/);
  assert.equal(requests[0].idempotencyKey, 'evalportal-invitation-accepted-invitation-123');
  assert.match(requests[1].body.subject, /Declined.*EvalPortal/);
  assert.match(requests[1].body.text, /Status: Declined/);
  assert.equal(requests[1].idempotencyKey, 'evalportal-invitation-rejected-invitation-123');
});

test('test-mode skipped invitation email is not reported as sent', async () => {
  process.env.NODE_ENV = 'test';
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('Unexpected Resend request');
  };

  const result = await emailService.sendTeamMemberAcceptedEmail({
    recipientEmail: 'leader@example.com',
    leaderName: 'Leader One',
    projectTitle: 'Test Project',
    teamMemberName: 'Student Two',
  });

  assert.deepEqual(result, { status: 'skipped' });
  assert.equal(fetchCalled, false);
});