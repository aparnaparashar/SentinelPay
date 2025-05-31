const nodemailer = require('nodemailer');
const logger = require('./logger');

/**
 * Send email using nodemailer
 * @param {Object} options - Email options
 * @param {string} options.email - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.message - Email text content
 * @param {string} options.html - Optional HTML content
 * @returns {Promise<Object>} - Email sending result
 */
exports.sendEmail = async (options) => {
  // Skip email sending in test mode
  if (process.env.NODE_ENV === 'test') {
    logger.info(`[TEST] Email would be sent to ${options.email} with subject: ${options.subject}`);
    return { success: true, mode: 'test' };
  }
  
  // Skip if SMTP not configured
  if (!process.env.SMTP_HOST) {
    logger.warn('Email sending skipped: SMTP not configured');
    return { success: false, error: 'SMTP not configured' };
  }
  
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    
    // Define email options
    const mailOptions = {
      from: process.env.EMAIL_FROM || '"SentinelPay" <noreply@sentinelpay.com>',
      to: options.email,
      subject: options.subject,
      text: options.message,
      html: options.html
    };
    
    // Send email
    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email sent to ${options.email}: ${info.messageId}`);
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Error sending email:', error);
    throw error;
  }
};