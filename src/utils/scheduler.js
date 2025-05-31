const schedule = require('node-schedule');
const logger = require('./logger');
const FraudDetectionService = require('../services/fraudDetectionService');
const ReportingService = require('../services/reportingService');
const BackupService = require('../services/backupService');
const { trainModels } = require('../ml/trainModels');
const NotificationService = require('../services/notificationService');

/**
 * Sets up all scheduled jobs for the application
 */
const setupScheduledJobs = () => {
  logger.info('Setting up scheduled jobs');
  
  // Daily fraud detection scan (runs at 1 AM every day)
  schedule.scheduleJob('0 1 * * *', async () => {
    logger.info('Starting daily fraud detection scan');
    try {
      const fraudDetectionService = new FraudDetectionService();
      const results = await fraudDetectionService.runDailyScan();
      logger.info(`Daily fraud scan complete: ${results.scannedTransactions} transactions processed, ${results.suspiciousCount} suspicious activities identified`);
      
      // Generate and send fraud report
      if (results.suspiciousCount > 0) {
        await NotificationService.sendDailyScanAlert(results.suspiciousTransactions);
      }
      
      // Generate daily report
      const reportingService = new ReportingService();
      await reportingService.generateFraudReport(results);
    } catch (error) {
      logger.error('Error during daily fraud scan:', error);
    }
  });
  
  // Weekly ML model training (runs at 3 AM every Sunday)
  schedule.scheduleJob('0 3 * * 0', async () => {
    logger.info('Starting weekly ML model training');
    try {
      const results = await trainModels();
      logger.info(`ML model training complete: ${results.modelAccuracy} accuracy achieved`);
    } catch (error) {
      logger.error('Error during ML model training:', error);
    }
  });
  
  // Daily database backup (runs at 2 AM every day)
  schedule.scheduleJob('0 2 * * *', async () => {
    logger.info('Starting daily database backup');
    try {
      const backupService = new BackupService();
      const result = await backupService.performDailyBackup();
      logger.info(`Database backup complete: ${result.backupSize} bytes saved to ${result.backupLocation}`);
    } catch (error) {
      logger.error('Error during database backup:', error);
    }
  });
  
  // Monthly data archiving (runs at 4 AM on the 1st of each month)
  schedule.scheduleJob('0 4 1 * *', async () => {
    logger.info('Starting monthly data archiving');
    try {
      const backupService = new BackupService();
      const result = await backupService.archiveOldData();
      logger.info(`Data archiving complete: ${result.archivedRecords} records archived`);
    } catch (error) {
      logger.error('Error during data archiving:', error);
    }
  });
  
  // Hourly check for large transactions (runs every hour)
  schedule.scheduleJob('0 * * * *', async () => {
    logger.info('Starting hourly large transaction check');
    try {
      const Transaction = require('../models/transactionModel');
      const lastHour = new Date();
      lastHour.setHours(lastHour.getHours() - 1);
      
      const largeTransactions = await Transaction.find({
        createdAt: { $gte: lastHour },
        amount: { $gte: 5000 },
        status: 'completed',
        isDeleted: false
      });
      
      for (const transaction of largeTransactions) {
        await NotificationService.sendTransactionNotification(transaction);
      }
      
      logger.info(`Checked ${largeTransactions.length} large transactions`);
    } catch (error) {
      logger.error('Error during large transaction check:', error);
    }
  });
  
  logger.info('All scheduled jobs have been set up');
};

module.exports = { setupScheduledJobs };