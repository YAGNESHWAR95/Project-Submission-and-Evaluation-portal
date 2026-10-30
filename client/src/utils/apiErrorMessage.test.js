import test from 'node:test';
import assert from 'node:assert/strict';
import { getFriendlyApiErrorMessage } from './apiErrorMessage.js';

test('network failures receive a useful retry message', () => {
  assert.match(getFriendlyApiErrorMessage({ message: 'Network Error' }), /Check your connection/);
});

test('empty authorization, missing-record, and validation responses use clear fallbacks', () => {
  assert.match(getFriendlyApiErrorMessage({ response: { status: 403 } }), /permission/);
  assert.match(getFriendlyApiErrorMessage({ response: { status: 404 } }), /could not be found/);
  assert.match(getFriendlyApiErrorMessage({ response: { status: 422 } }), /check the information/);
});

test('backend validation messages are preserved and server details are hidden', () => {
  assert.equal(getFriendlyApiErrorMessage({
    response: { status: 400, data: { message: 'Project title is required.' } },
  }), 'Project title is required.');
  assert.match(getFriendlyApiErrorMessage({
    response: { status: 500, data: { message: 'MongoError: secret internal detail' } },
  }), /^The server could not complete/);
});

test('authentication failures distinguish login from expired sessions', () => {
  assert.match(getFriendlyApiErrorMessage({
    config: { url: '/auth/login' }, response: { status: 401 },
  }), /Sign-in failed/);
  assert.match(getFriendlyApiErrorMessage({ response: { status: 401 } }), /session has expired/);
});