const dotenv = require('dotenv');
const envPath = require('path').resolve(__dirname, '../../.env');
const loadedEnv = dotenv.config({ path: envPath });

Object.entries(loadedEnv.parsed || {}).forEach(([name, value]) => {
  if (!process.env[name]?.trim() && value.trim()) {
    process.env[name] = value;
  }
});

const { Resend } = require('resend');
const logger = require('../utils/logger');

const getResendConfig = (emailType, recipientEmail) => {
  const config = {
    apiKey: process.env.RESEND_API_KEY?.trim(),
    from: process.env.EMAIL_FROM?.trim(),
    clientUrl: process.env.CLIENT_URL?.trim(),
  };
  logger.info(`[EMAIL SERVICE] type=${emailType} recipient=${recipientEmail || 'unavailable'} apiKeyPresent=${Boolean(config.apiKey)} senderConfigured=${Boolean(config.from)} clientUrlConfigured=${Boolean(config.clientUrl)} providerRequestAttempted=false`);
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([name]) => ({ apiKey: 'RESEND_API_KEY', from: 'EMAIL_FROM', clientUrl: 'CLIENT_URL' })[name]);

  if (missing.length) {
    logger.warn(`[EMAIL SERVICE] Resend not fully configured. Missing: ${missing.join(', ')}.`);
    return null;
  }

  return config;
};

const formatResendError = (error, apiKey) => {
  const message = error?.message || String(error || 'Unknown Resend error');
  return String(message)
    .replaceAll(apiKey, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bre_[A-Za-z0-9_-]+\b/g, '[REDACTED]');
};

const sendResendEmail = async ({ apiKey, from, recipientEmail, subject, text, html, context, emailType, idempotencyKey }) => {
  try {
    logger.info(`[EMAIL SERVICE] type=${emailType} recipient=${recipientEmail} apiKeyPresent=${Boolean(apiKey)} senderConfigured=${Boolean(from)} providerRequestAttempted=true`);
    const response = await new Resend(apiKey).emails.send({
      from,
      to: [recipientEmail],
      subject,
      text,
      html,
    }, idempotencyKey ? { idempotencyKey } : undefined);

    if (response?.error) {
      logger.error(`[EMAIL SERVICE] ${context} failed for ${recipientEmail}: ${formatResendError(response.error, apiKey)}`);
      return { status: 'failed' };
    }

    if (!response?.data?.id) {
      logger.error(`[EMAIL SERVICE] ${context} failed for ${recipientEmail}: Resend returned no email ID.`);
      return { status: 'failed' };
    }

    logger.info(`[EMAIL SERVICE] ${context} accepted by Resend for ${recipientEmail}. Resend ID: ${response.data.id}`);
    return { status: 'accepted_by_resend', id: response.data.id };
  } catch (error) {
    logger.error(`[EMAIL SERVICE] ${context} failed for ${recipientEmail}: ${formatResendError(error, apiKey)}`);
    return { status: 'failed' };
  }
};

const buildInvitationLink = (token) => {
  const baseUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${baseUrl}/team-invitations/${token}`;
};

const buildProjectTeamLink = () => {
  const baseUrl = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, '');
  return `${baseUrl}/`;
};

const sendFacultyAssignmentEmail = async ({
  recipientEmail,
  facultyName,
  projectTitle,
  teamLeaderName,
  department,
  section,
}) => {
  if (!recipientEmail || !facultyName || !projectTitle) {
    logger.warn('[EMAIL SERVICE] Missing faculty assignment email fields. Skipping assignment email.');
    return { status: 'skipped' };
  }

  if (process.env.NODE_ENV === 'test') {
    logger.info('[EMAIL SERVICE] Test mode enabled. Skipping outbound faculty-assignment email.');
    return { status: 'skipped' };
  }

  const config = getResendConfig('faculty_assignment', recipientEmail);
  if (!config) {
    logger.warn('[EMAIL SERVICE] Resend not configured. Faculty assignment email was not sent.');
    return { status: 'skipped' };
  }

  const projectLink = buildProjectTeamLink();
  const safeFacultyName = facultyName || 'Faculty';
  const safeProjectTitle = projectTitle || 'Project';
  const safeLeaderName = teamLeaderName || 'Project Team Leader';
  const safeDepartment = department || 'Not specified';
  const safeSection = section || 'Not specified';

  const textBody = [
    `Hello ${safeFacultyName},`,
    '',
    `You have been assigned as the faculty guide for "${safeProjectTitle}".`,
    '',
    `Project: ${safeProjectTitle}`,
    `Team Leader: ${safeLeaderName}`,
    `Department: ${safeDepartment}`,
    `Section: ${safeSection}`,
    '',
    `Please review the project here: ${projectLink}`,
    '',
    'Regards,',
    'Project Submission & Evaluation Portal',
  ].join('\n');

  return sendResendEmail({
    apiKey: config.apiKey,
    from: config.from,
    recipientEmail,
    subject: `New Project Assignment: ${safeProjectTitle}`,
    text: textBody,
    html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
          <h2 style="margin-bottom: 12px;">New Project Assigned to You</h2>
          <p>Hello <strong>${safeFacultyName}</strong>,</p>
          <p>You have been assigned as the faculty guide for <strong>${safeProjectTitle}</strong>.</p>
          <ul>
            <li><strong>Project:</strong> ${safeProjectTitle}</li>
            <li><strong>Team Leader:</strong> ${safeLeaderName}</li>
            <li><strong>Department:</strong> ${safeDepartment}</li>
            <li><strong>Section:</strong> ${safeSection}</li>
          </ul>
          <p>
            <a href="${projectLink}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 18px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Project</a>
          </p>
          <p>Regards,<br />Project Submission & Evaluation Portal</p>
        </div>
      `,
    context: 'Faculty assignment email',
    emailType: 'faculty_assignment',
  });
};

const sendTeamInvitationEmail = async ({
  recipientEmail,
  recipientName,
  inviterName,
  projectTitle,
  token,
  invitationId,
  department,
  section,
}) => {
  if (!recipientEmail || !token) {
    logger.warn('[EMAIL SERVICE] Missing recipient email or invitation token. Skipping email send.');
    return { status: 'skipped' };
  }

  if (process.env.NODE_ENV === 'test') {
    logger.info('[EMAIL SERVICE] Test mode enabled. Skipping outbound email while the invitation tests run.');
    return { status: 'skipped' };
  }

  const config = getResendConfig('invitation', recipientEmail);
  if (!config) return { status: 'skipped' };

  const invitationLink = buildInvitationLink(token);
  const safeRecipientName = recipientName || 'Student';
  const safeInviterName = inviterName || 'Project Team Leader';
  const safeDepartment = department || 'Not specified';
  const safeSection = section || 'Not specified';

  const textBody = [
    `Hello ${safeRecipientName},`,
    '',
    `${safeInviterName} has invited you to join the project team for "${projectTitle}".`,
    '',
    `Project: ${projectTitle}`,
    `Team Leader: ${safeInviterName}`,
    `Department: ${safeDepartment}`,
    `Section: ${safeSection}`,
    '',
    `Please review and accept the invitation here: ${invitationLink}`,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
    '',
    'Regards,',
    'Project Submission & Evaluation Portal',
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="margin-bottom: 12px;">You've been invited to join a project team</h2>
      <p>Hello <strong>${safeRecipientName}</strong>,</p>
      <p><strong>${safeInviterName}</strong> has invited you to join the project team for <strong>${projectTitle}</strong>.</p>
      <ul>
        <li><strong>Project:</strong> ${projectTitle}</li>
        <li><strong>Team Leader:</strong> ${safeInviterName}</li>
        <li><strong>Department:</strong> ${safeDepartment}</li>
        <li><strong>Section:</strong> ${safeSection}</li>
      </ul>
      <p>You can review the invitation and accept it from the portal:</p>
      <p>
        <a href="${invitationLink}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 18px; text-decoration: none; border-radius: 8px; font-weight: 600;">
          Accept Invitation
        </a>
      </p>
      <p>If you were not expecting this invitation, you can ignore this email.</p>
      <p>Regards,<br />Project Submission & Evaluation Portal</p>
    </div>
  `;

  return sendResendEmail({
    apiKey: config.apiKey,
    from: config.from,
    recipientEmail,
    subject: `You've been invited to join ${projectTitle}`,
    text: textBody,
    html: htmlBody,
    context: 'Team invitation email',
    emailType: 'invitation',
    idempotencyKey: invitationId ? `evalportal-invitation-created-${invitationId}` : undefined,
  });
};

const sendTeamMemberInvitationStatusEmail = async ({
  status,
  recipientEmail,
  leaderName,
  projectTitle,
  teamMemberName,
  teamMemberEmail,
  rollNumber,
  invitationId,
  occurredAt,
}) => {
  if (!recipientEmail || !leaderName || !projectTitle || !teamMemberName || !['accepted', 'rejected'].includes(status)) {
    logger.warn('[EMAIL SERVICE] Missing invitation acknowledgement email fields. Skipping email send.');
    return { status: 'skipped' };
  }

  if (process.env.NODE_ENV === 'test') {
    logger.info('[EMAIL SERVICE] Test mode enabled. Skipping outbound invitation acknowledgement email.');
    return { status: 'skipped' };
  }

  const emailType = status === 'accepted' ? 'acceptance' : 'rejection';
  const config = getResendConfig(emailType, recipientEmail);
  if (!config) return { status: 'skipped' };

  const accepted = status === 'accepted';
  const action = accepted ? 'accepted' : 'declined';
  const safeLeaderName = leaderName || 'Project Team Leader';
  const safeProjectTitle = projectTitle || 'Project';
  const safeTeamMemberName = teamMemberName || 'Project member';
  const safeTeamMemberEmail = teamMemberEmail || 'Not provided';
  const safeRollNumber = rollNumber || 'Not provided';
  const actionDate = new Date(occurredAt || Date.now()).toISOString();
  const projectLink = buildProjectTeamLink();
  const subject = `Team Invitation ${accepted ? 'Accepted' : 'Declined'} - EvalPortal`;

  const textBody = [
    `Hello ${safeLeaderName},`,
    '',
    `Good news! ${safeTeamMemberName} has ${action} your invitation to join the project team.`,
    '',
    `Project: ${safeProjectTitle}`,
    `Student: ${safeTeamMemberName}`,
    `Student email: ${safeTeamMemberEmail}`,
    `Roll Number: ${safeRollNumber}`,
    `Status: ${accepted ? 'Accepted' : 'Declined'}`,
    `Date and time (UTC): ${actionDate}`,
    '',
    `View your project team in EvalPortal: ${projectLink}`,
    '',
    'Regards,',
    'EvalPortal Team',
  ].join('\n');

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2 style="margin-bottom: 12px;">Team Invitation ${accepted ? 'Accepted' : 'Declined'}</h2>
      <p>Hello <strong>${safeLeaderName}</strong>,</p>
      <p>Good news! <strong>${safeTeamMemberName}</strong> has ${action} your invitation to join the project team.</p>
      <ul>
        <li><strong>Project:</strong> ${safeProjectTitle}</li>
        <li><strong>Student:</strong> ${safeTeamMemberName}</li>
        <li><strong>Student email:</strong> ${safeTeamMemberEmail}</li>
        <li><strong>Roll Number:</strong> ${safeRollNumber}</li>
        <li><strong>Status:</strong> ${accepted ? 'Accepted' : 'Declined'}</li>
        <li><strong>Date and time (UTC):</strong> ${actionDate}</li>
      </ul>
      <p>
        <a href="${projectLink}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 18px; text-decoration: none; border-radius: 8px; font-weight: 600;">
          View Project in EvalPortal
        </a>
      </p>
      <p>Regards,<br />EvalPortal Team</p>
    </div>
  `;

  return sendResendEmail({
    apiKey: config.apiKey,
    from: config.from,
    recipientEmail,
    subject,
    text: textBody,
    html: htmlBody,
    context: `Team invitation ${status} acknowledgement email`,
    emailType,
    idempotencyKey: invitationId ? `evalportal-invitation-${status}-${invitationId}` : undefined,
  });
};

const sendTeamMemberAcceptedEmail = (details) => sendTeamMemberInvitationStatusEmail({
  ...details,
  status: 'accepted',
});

const sendTeamMemberRejectedEmail = (details) => sendTeamMemberInvitationStatusEmail({
  ...details,
  status: 'rejected',
});

module.exports = {
  sendTeamInvitationEmail,
  sendTeamMemberAcceptedEmail,
  sendTeamMemberRejectedEmail,
  sendFacultyAssignmentEmail,
  buildInvitationLink,
  buildProjectTeamLink,
};
