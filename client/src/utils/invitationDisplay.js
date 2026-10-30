const getReferenceId = (value) => {
  const id = value?._id || value?.id || value;
  return id === undefined || id === null ? '' : String(id);
};

const getStudentKey = (invitation) => {
  const invitedUserId = getReferenceId(invitation.invitedUser || invitation.invitedUserId);
  if (invitedUserId) return `id:${invitedUserId}`;
  const rollNumber = invitation.invitedUser?.rollNumber || invitation.rollNumber;
  if (rollNumber) return `roll:${String(rollNumber).trim().toUpperCase()}`;
  const email = invitation.invitedUser?.email || invitation.email;
  if (email) return `email:${String(email).trim().toLowerCase()}`;
  return `invitation:${getReferenceId(invitation._id || invitation.token)}`;
};

export const getInvitationDisplayStatus = (invitation, now = Date.now()) => (
  invitation.status === 'pending'
  && invitation.expiresAt
  && new Date(invitation.expiresAt).getTime() < now
    ? 'expired'
    : invitation.status
);

export const groupInvitationHistory = (invitations = [], acceptedMemberIds = [], now = Date.now()) => {
  const memberIds = new Set(acceptedMemberIds.map(getReferenceId).filter(Boolean));
  const groups = new Map();
  const seenRecords = new Set();

  invitations.forEach((invitation) => {
    if (!invitation) return;
    const studentKey = getStudentKey(invitation);
    const projectId = getReferenceId(invitation.project) || 'project';
    const groupKey = `${projectId}:${studentKey}`;
    const recordId = getReferenceId(invitation._id || invitation.token)
      || `${groupKey}:${invitation.status}:${invitation.createdAt || ''}`;
    if (seenRecords.has(recordId)) return;
    seenRecords.add(recordId);

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(invitation);
  });

  return [...groups.entries()].map(([key, records]) => {
    records.sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
    const invitedUserId = getReferenceId(records[0]?.invitedUser || records[0]?.invitedUserId);
    const acceptedMember = Boolean(invitedUserId && memberIds.has(invitedUserId));
    const acceptedRecord = acceptedMember && records.find((record) => record.status === 'accepted');
    const currentInvitation = acceptedRecord || records[0];
    const student = records.find((record) => (
      record.invitedUser && typeof record.invitedUser === 'object'
      && (record.invitedUser.name || record.invitedUser.rollNumber || record.invitedUser.email)
    ))?.invitedUser || currentInvitation.invitedUser;

    return {
      key,
      student,
      status: acceptedMember ? 'accepted' : getInvitationDisplayStatus(currentInvitation, now),
      invitation: currentInvitation,
      attempts: records.filter((record) => record !== currentInvitation),
    };
  });
};