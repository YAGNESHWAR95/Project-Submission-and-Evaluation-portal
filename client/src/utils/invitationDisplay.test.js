import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInvitationHistory } from './invitationDisplay.js';

test('group invitation attempts by project and canonical student ID', () => {
  const invitations = [
    { _id: 'old', project: 'project-1', invitedUser: { _id: 'student-1', name: 'Jyosna' }, status: 'rejected', createdAt: '2026-01-01' },
    { _id: 'current', project: 'project-1', invitedUser: { _id: 'student-1', name: 'Jyosna' }, status: 'pending', createdAt: '2026-02-01' },
    { _id: 'current', project: 'project-1', invitedUser: { _id: 'student-1', name: 'Jyosna' }, status: 'pending', createdAt: '2026-02-01' },
    { _id: 'other-project', project: 'project-2', invitedUser: { _id: 'student-1', name: 'Jyosna' }, status: 'accepted', createdAt: '2026-03-01' },
  ];

  const groups = groupInvitationHistory(invitations, [], Date.parse('2026-04-01'));

  assert.equal(groups.length, 2);
  const projectGroup = groups.find((group) => group.invitation.project === 'project-1');
  assert.equal(projectGroup.status, 'pending');
  assert.equal(projectGroup.invitation._id, 'current');
  assert.equal(projectGroup.attempts.length, 1);
  assert.equal(projectGroup.attempts[0].status, 'rejected');
});

test('accepted team membership controls the current group status without removing pending history', () => {
  const groups = groupInvitationHistory([
    { _id: 'pending', project: 'project-1', invitedUser: { _id: 'student-1', name: 'Jyosna', rollNumber: ' 23IT0001 ' }, status: 'pending', createdAt: '2026-03-01' },
    { _id: 'accepted', project: 'project-1', invitedUser: { _id: 'student-1', name: 'Jyosna', email: 'JYOSNA@example.edu' }, status: 'accepted', createdAt: '2026-02-01' },
  ], ['student-1'], Date.parse('2026-04-01'));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].status, 'accepted');
  assert.equal(groups[0].attempts.length, 1);
  assert.equal(groups[0].attempts[0].status, 'pending');
});

test('expired pending attempts are displayed as expired without mutating their records', () => {
  const invitation = {
    _id: 'expired',
    project: 'project-1',
    invitedUser: { _id: 'student-1', name: 'Jyosna' },
    status: 'pending',
    expiresAt: '2026-01-01',
  };
  const groups = groupInvitationHistory([invitation], [], Date.parse('2026-04-01'));

  assert.equal(groups[0].status, 'expired');
  assert.equal(invitation.status, 'pending');
});