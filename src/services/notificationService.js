const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

class NotificationService {
  /**
   * Send fraud alert notification
   * @param {Object} transaction - Transaction object
   * @param {Object} fraudResult - Fraud detection result
   */
  async sendFraudAlert(transaction, fraudResult) {
    try {
      const subject = `ALERT: High-Risk Transaction Detected (Score: ${Math.round(fraudResult.score * 100)}%)`;
      
      const message = `
        A high-risk transaction has been detected and requires review:
        
        Transaction ID: ${transaction._id}
        Reference: ${transaction.reference}
        Amount: ${transaction.amount} ${transaction.currency}
        Type: ${transaction.transactionType}
        Date: ${transaction.createdAt}
        Fraud Score: ${Math.round(fraudResult.score * 100)}%
        
        The transaction has been placed in pending status for review.
        Please check the admin dashboard for more details.
      `;
      
      // Send to admin notification channel
      await this._sendAdminNotification(subject, message, 'high');
      
      logger.info(`Fraud alert sent for transaction ${transaction._id}`);
    } catch (error) {
      logger.error('Error sending fraud alert:', error);
    }
  }
  
  /**
   * Send notification for high-priority fraud cases
   * @param {Object} fraudCase - Fraud case object
   */
  async sendHighPriorityFraudAlert(fraudCase) {
    try {
      const subject = `URGENT: Critical Fraud Alert (Score: ${Math.round(fraudCase.fraudScore)}%)`;
      
      const message = `
        A critical fraud case has been detected and requires immediate attention:
        
        Case ID: ${fraudCase._id}
        Detection Type: ${fraudCase.detectionType}
        Fraud Score: ${Math.round(fraudCase.fraudScore)}%
        Description: ${fraudCase.description}
        
        Transaction ID: ${fraudCase.transactionId}
        Account ID: ${fraudCase.accountId}
        User ID: ${fraudCase.userId}
        
        This case has been marked as high-priority and requires immediate review.
      `;
      
      // Send to admin notification channel with high priority
      await this._sendAdminNotification(subject, message, 'critical');
      
      logger.info(`High-priority fraud alert sent for case ${fraudCase._id}`);
    } catch (error) {
      logger.error('Error sending high-priority fraud alert:', error);
    }
  }
  
  /**
   * Send notification for daily fraud scan
   * @param {Array} suspiciousTransactions - List of suspicious transactions
   */
  async sendDailyScanAlert(suspiciousTransactions) {
    try {
      const count = suspiciousTransactions.length;
      const subject = `Daily Fraud Scan Report: ${count} Suspicious ${count === 1 ? 'Transaction' : 'Transactions'} Detected`;
      
      let message = `
        Daily fraud scan has completed with the following results:
        
        Total suspicious transactions detected: ${count}
        
        Summary of suspicious transactions:
      `;
      
      // Add summary of suspicious transactions
      suspiciousTransactions.forEach((item, index) => {
        const { transaction, fraudResult } = item;
        message += `
        ${index + 1}. Transaction ID: ${transaction._id}
           Amount: ${transaction.amount} ${transaction.currency}
           Type: ${transaction.transactionType}
           Date: ${transaction.createdAt}
           Fraud Score: ${Math.round(fraudResult.score * 100)}%
        `;
      });
      
      message += `
        Please review these transactions in the admin dashboard.
      `;
      
      // Send to admin notification channel
      await this._sendAdminNotification(subject, message, 'medium');
      
      logger.info(`Daily fraud scan alert sent with ${count} suspicious transactions`);
    } catch (error) {
      logger.error('Error sending daily scan alert:', error);
    }
  }
  
  /**
   * Send transaction notification to user
   * @param {Object} transaction - Transaction object
   */
  async sendTransactionNotification(transaction) {
    try {
      // Get user info
      const Account = require('../models/accountModel');
      const User = require('../models/userModel');
      
      let userId;
      let accountNumber;
      
      if (transaction.sourceAccountId) {
        const account = await Account.findById(transaction.sourceAccountId);
        if (account) {
          userId = account.userId;
          accountNumber = account.accountNumber;
        }
      } else if (transaction.destinationAccountId) {
        const account = await Account.findById(transaction.destinationAccountId);
        if (account) {
          userId = account.userId;
          accountNumber = account.accountNumber;
        }
      }
      
      if (!userId) {
        logger.warn(`Cannot send transaction notification: User not found for transaction ${transaction._id}`);
        return;
      }
      
      const user = await User.findById(userId);
      
      if (!user || !user.email) {
        logger.warn(`Cannot send transaction notification: Invalid user email for transaction ${transaction._id}`);
        return;
      }
      
      // Format account number for display (mask middle digits)
      const maskedAccountNumber = this._maskAccountNumber(accountNumber);
      
      // Format transaction amount
      const amount = (transaction.amount / 100).toFixed(2); // Assuming amount is stored in cents
      
      const subject = `Transaction Notification: ${transaction.transactionType.charAt(0).toUpperCase() + transaction.transactionType.slice(1)}`;
      
      const message = `
        Dear ${user.firstName},
        
        A ${transaction.transactionType} transaction has been processed on your account:
        
        Account: ${maskedAccountNumber}
        Amount: ${amount} ${transaction.currency}
        Date: ${new Date(transaction.createdAt).toLocaleString()}
        Reference: ${transaction.reference}
        Status: ${transaction.status.toUpperCase()}
        
        If you did not authorize this transaction, please contact us immediately.
        
        Thank you,
        SentinelPay Team
      `;
      
      await this._sendUserEmail(user.email, subject, message);
      
      logger.info(`Transaction notification sent to user ${userId} for transaction ${transaction._id}`);
    } catch (error) {
      logger.error('Error sending transaction notification:', error);
    }
  }
  
  /**
   * Send account frozen notification
   * @param {Object} account - Account object
   * @param {Object} fraudCase - Fraud case object
   */
  async sendAccountFrozenNotification(account, fraudCase) {
    try {
      const User = require('../models/userModel');
      const user = await User.findById(account.userId);
      
      if (!user || !user.email) {
        logger.warn(`Cannot send frozen account notification: Invalid user email for account ${account._id}`);
        return;
      }
      
      const subject = 'IMPORTANT: Your Account Has Been Frozen';
      
      const message = `
        Dear ${user.firstName},
        
        For your protection, we have temporarily frozen your account ending in ${account.accountNumber.slice(-4)} due to suspicious activity.
        
        Our fraud detection system has identified potentially unauthorized transactions on your account. This is a precautionary measure to protect your funds.
        
        Please contact our customer service center immediately at the number on the back of your card to verify recent transactions and restore access to your account.
        
        Thank you for your understanding,
        SentinelPay Security Team
      `;
      
      await this._sendUserEmail(user.email, subject, message);
      
      // Also send SMS if phone number is available
      if (user.phoneNumber) {
        await this._sendSMS(
          user.phoneNumber,
          `ALERT: Your SentinelPay account ending in ${account.accountNumber.slice(-4)} has been frozen due to suspicious activity. Please contact customer service immediately.`
        );
      }
      
      logger.info(`Account frozen notification sent to user ${user._id} for account ${account._id}`);
    } catch (error) {
      logger.error('Error sending account frozen notification:', error);
    }
  }
  
  /**
   * Send notification about transaction reversal
   * @param {Object} transaction - Reversal transaction object
   */
  async sendReversalNotification(transaction) {
    try {
      // Get source account and user info
      const Account = require('../models/accountModel');
      const User = require('../models/userModel');
      
      let userId;
      let accountNumber;
      
      if (transaction.sourceAccountId) {
        const account = await Account.findById(transaction.sourceAccountId);
        if (account) {
          userId = account.userId;
          accountNumber = account.accountNumber;
        }
      }
      
      if (!userId) {
        logger.warn(`Cannot send reversal notification: User not found for transaction ${transaction._id}`);
        return;
      }
      
      const user = await User.findById(userId);
      
      if (!user || !user.email) {
        logger.warn(`Cannot send reversal notification: Invalid user email for transaction ${transaction._id}`);
        return;
      }
      
      // Format account number for display (mask middle digits)
      const maskedAccountNumber = this._maskAccountNumber(accountNumber);
      
      // Format transaction amount
      const amount = (transaction.amount / 100).toFixed(2); // Assuming amount is stored in cents
      
      const subject = 'Transaction Reversal Notification';
      
      const message = `
        Dear ${user.firstName},
        
        A transaction has been reversed on your account:
        
        Account: ${maskedAccountNumber}
        Amount: ${amount} ${transaction.currency}
        Date: ${new Date(transaction.createdAt).toLocaleString()}
        Reference: ${transaction.reference}
        Reason: ${transaction.description}
        
        The funds have been returned to your account. If you have any questions about this reversal, please contact customer support.
        
        Thank you,
        SentinelPay Team
      `;
      
      await this._sendUserEmail(user.email, subject, message);
      
      logger.info(`Reversal notification sent to user ${userId} for transaction ${transaction._id}`);
    } catch (error) {
      logger.error('Error sending reversal notification:', error);
    }
  }
  
  /**
   * Send notification for user-reported fraud
   * @param {Object} fraudCase - Fraud case object
   * @param {Object} user - User who reported the fraud
   */
  async sendFraudReportNotification(fraudCase, user) {
    try {
      // Send confirmation to user
      const userSubject = 'Fraud Report Received: We\'re Investigating';
      
      const userMessage = `
        Dear ${user.firstName},
        
        Thank you for reporting potentially fraudulent activity. We take these reports very seriously and have begun an investigation.
        
        Case Reference: ${fraudCase._id}
        Reported: ${new Date().toLocaleString()}
        
        Our fraud team will review the details you've provided and may contact you for additional information. If your account is at risk, we will take immediate action to secure it.
        
        What happens next:
        1. Your case has been assigned to our fraud investigation team
        2. We will review the transaction and account activity
        3. We will contact you within 24-48 hours with our findings
        
        If you notice any additional suspicious activity, please let us know immediately.
        
        Thank you for your vigilance,
        SentinelPay Security Team
      `;
      
      await this._sendUserEmail(user.email, userSubject, userMessage);
      
      // Send notification to admin team
      const adminSubject = `New Fraud Report: Case #${fraudCase._id}`;
      
      const adminMessage = `
        A user has reported fraudulent activity:
        
        Case ID: ${fraudCase._id}
        User: ${user.firstName} ${user.lastName} (ID: ${user._id})
        Transaction ID: ${fraudCase.transactionId}
        Account ID: ${fraudCase.accountId}
        Description: ${fraudCase.description}
        
        This case has been automatically assigned high priority and requires immediate review.
      `;
      
      // Send to admin notification channel with high priority
      await this._sendAdminNotification(adminSubject, adminMessage, 'high');
      
      logger.info(`Fraud report notifications sent for case ${fraudCase._id}`);
    } catch (error) {
      logger.error('Error sending fraud report notifications:', error);
    }
  }
  
  // PRIVATE METHODS
  
  /**
   * Send email to user
   * @private
   */
  async _sendUserEmail(to, subject, message) {
    try {
      if (!process.env.SMTP_HOST || !process.env.NODE_ENV === 'test') {
        logger.warn('Email sending skipped: SMTP not configured or test environment');
        return;
      }
      
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"SentinelPay" <noreply@sentinelpay.com>',
        to,
        subject,
        text: message
      });
    } catch (error) {
      logger.error('Error sending email:', error);
    }
  }
  
  /**
   * Send SMS notification (placeholder - would need SMS service integration)
   * @private
   */
  async _sendSMS(phoneNumber, message) {
    try {
      // This is a placeholder. In a real application, you would integrate
      // with an SMS service provider like Twilio, Nexmo, etc.
      logger.info(`SMS notification would be sent to ${phoneNumber}: ${message}`);
    } catch (error) {
      logger.error('Error sending SMS:', error);
    }
  }
  
  /**
   * Send notification to admin channel
   * @private
   */
  async _sendAdminNotification(subject, message, priority = 'medium') {
    try {
      // In a real application, this would send to admin notification channels
      // like email distribution lists, Slack, Microsoft Teams, etc.
      
      // For this example, we'll just log it
      logger.info(`[${priority.toUpperCase()} PRIORITY] Admin notification: ${subject}`);
      
      // Send email to admin address if configured
      if (process.env.ADMIN_EMAIL) {
        await this._sendUserEmail(
          process.env.ADMIN_EMAIL,
          `[${priority.toUpperCase()}] ${subject}`,
          message
        );
      }
    } catch (error) {
      logger.error('Error sending admin notification:', error);
    }
  }
  
  /**
   * Mask account number for security
   * @private
   */
  _maskAccountNumber(accountNumber) {
    if (!accountNumber) return 'Unknown Account';
    return accountNumber.slice(0, 4) + '*'.repeat(accountNumber.length - 8) + accountNumber.slice(-4);
  }
}

module.exports = new NotificationService();