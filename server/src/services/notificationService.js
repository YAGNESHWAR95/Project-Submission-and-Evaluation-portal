const logger = require('../utils/logger');

const sendEmailAlert = async (to, subject, text, html) => {
  try {
    // In production, instantiate Nodemailer / Resend / AWS SES here.
    // For local evaluation, we print email payloads clearly in console logs.
    logger.info(`[EMAIL ALERTS] Dispatching email to: ${to}`);
    logger.info(`[EMAIL ALERTS] Subject: "${subject}"`);
    logger.info(`[EMAIL ALERTS] Body Summary: "${text.substring(0, 100)}..."`);
    
    // Simulate slight network latency
    return true;
  } catch (error) {
    logger.error(`[EMAIL ALERTS] Failed to dispatch alert: ${error.message}`);
    return false;
  }
};

module.exports = {
  sendEmailAlert,
};
