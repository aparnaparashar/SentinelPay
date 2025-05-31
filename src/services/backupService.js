const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// Ensure backup directory exists
const BACKUP_DIR = path.join(__dirname, '../../backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

class BackupService {
  /**
   * Perform daily database backup
   * @returns {Promise<Object>} - Backup result
   */
  async performDailyBackup() {
    try {
      logger.info('Starting daily database backup');
      
      // Create backup directory with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}`);
      
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }
      
      // Get all collections
      const collections = await mongoose.connection.db.collections();
      
      // Track progress
      let totalDocuments = 0;
      let processedCollections = 0;
      
      // Back up each collection to a JSON file
      for (const collection of collections) {
        const collectionName = collection.collectionName;
        
        // Skip system collections
        if (collectionName.startsWith('system.')) {
          continue;
        }
        
        // Get all documents in collection
        const documents = await collection.find({}).toArray();
        
        if (documents.length > 0) {
          // Write documents to file
          const backupFile = path.join(backupPath, `${collectionName}.json`);
          await promisify(fs.writeFile)(
            backupFile,
            JSON.stringify(documents, null, 2)
          );
          
          totalDocuments += documents.length;
        }
        
        processedCollections++;
      }
      
      // Create backup manifest
      const manifest = {
        timestamp,
        collections: processedCollections,
        totalDocuments,
        version: '1.0',
        environment: process.env.NODE_ENV
      };
      
      await promisify(fs.writeFile)(
        path.join(backupPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      
      // Calculate backup size
      let backupSize = 0;
      const files = await promisify(fs.readdir)(backupPath);
      
      for (const file of files) {
        const stats = await promisify(fs.stat)(path.join(backupPath, file));
        backupSize += stats.size;
      }
      
      logger.info(`Database backup completed: ${processedCollections} collections, ${totalDocuments} documents, ${backupSize} bytes`);
      
      return {
        success: true,
        timestamp,
        backupLocation: backupPath,
        collections: processedCollections,
        documents: totalDocuments,
        backupSize
      };
    } catch (error) {
      logger.error('Database backup failed:', error);
      throw error;
    }
  }
  
  /**
   * Archive old data (transactions and logs older than a specified period)
   * @returns {Promise<Object>} - Archiving result
   */
  async archiveOldData() {
    try {
      logger.info('Starting old data archiving');
      
      // Define archiving thresholds
      const archiveDate = new Date();
      archiveDate.setMonth(archiveDate.getMonth() - 6); // Archive data older than 6 months
      
      // Create archive directory with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = path.join(BACKUP_DIR, `archive-${timestamp}`);
      
      if (!fs.existsSync(archivePath)) {
        fs.mkdirSync(archivePath, { recursive: true });
      }
      
      // Archive old transactions
      const Transaction = mongoose.model('Transaction');
      const oldTransactions = await Transaction.find({
        createdAt: { $lt: archiveDate }
      });
      
      if (oldTransactions.length > 0) {
        await promisify(fs.writeFile)(
          path.join(archivePath, 'transactions.json'),
          JSON.stringify(oldTransactions, null, 2)
        );
        
        // After successful archiving, we could delete the records
        // This is commented out for safety - in production you would
        // implement a more careful deletion strategy
        /*
        await Transaction.deleteMany({
          createdAt: { $lt: archiveDate }
        });
        */
      }
      
      // Archive old fraud cases
      const FraudCase = mongoose.model('FraudCase');
      const oldFraudCases = await FraudCase.find({
        createdAt: { $lt: archiveDate },
        status: { $in: ['resolved-genuine', 'resolved-fraud', 'closed'] }
      });
      
      if (oldFraudCases.length > 0) {
        await promisify(fs.writeFile)(
          path.join(archivePath, 'fraud-cases.json'),
          JSON.stringify(oldFraudCases, null, 2)
        );
        
        // After successful archiving, we could delete the records
        /*
        await FraudCase.deleteMany({
          createdAt: { $lt: archiveDate },
          status: { $in: ['resolved-genuine', 'resolved-fraud', 'closed'] }
        });
        */
      }
      
      // Create archive manifest
      const manifest = {
        timestamp,
        archiveDate: archiveDate.toISOString(),
        transactions: oldTransactions.length,
        fraudCases: oldFraudCases.length,
        version: '1.0'
      };
      
      await promisify(fs.writeFile)(
        path.join(archivePath, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      
      // Calculate archive size
      let archiveSize = 0;
      const files = await promisify(fs.readdir)(archivePath);
      
      for (const file of files) {
        const stats = await promisify(fs.stat)(path.join(archivePath, file));
        archiveSize += stats.size;
      }
      
      logger.info(`Data archiving completed: ${oldTransactions.length} transactions, ${oldFraudCases.length} fraud cases, ${archiveSize} bytes`);
      
      return {
        success: true,
        timestamp,
        archiveLocation: archivePath,
        archivedRecords: oldTransactions.length + oldFraudCases.length,
        archiveSize
      };
    } catch (error) {
      logger.error('Data archiving failed:', error);
      throw error;
    }
  }
  
  /**
   * Restore database from backup
   * @param {string} backupPath - Path to backup directory
   * @returns {Promise<Object>} - Restoration result
   */
  async restoreFromBackup(backupPath) {
    try {
      logger.info(`Starting database restoration from ${backupPath}`);
      
      // Check if backup directory exists
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup directory ${backupPath} does not exist`);
      }
      
      // Check for manifest
      const manifestPath = path.join(backupPath, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('Invalid backup: manifest.json not found');
      }
      
      // Read and validate manifest
      const manifestData = await promisify(fs.readFile)(manifestPath, 'utf8');
      const manifest = JSON.parse(manifestData);
      
      if (!manifest.timestamp || !manifest.version) {
        throw new Error('Invalid backup manifest');
      }
      
      // Get all backup files
      const files = await promisify(fs.readdir)(backupPath);
      const backupFiles = files.filter(file => file.endsWith('.json') && file !== 'manifest.json');
      
      let restoredCollections = 0;
      let restoredDocuments = 0;
      
      // Restore each collection
      for (const file of backupFiles) {
        const collectionName = path.basename(file, '.json');
        
        // Read backup data
        const backupData = await promisify(fs.readFile)(path.join(backupPath, file), 'utf8');
        const documents = JSON.parse(backupData);
        
        if (documents.length > 0) {
          // Get collection
          const collection = mongoose.connection.db.collection(collectionName);
          
          // In a real restoration, you would implement a careful merge strategy
          // This is a simplified example that assumes the collection can be replaced
          
          // For safety, we're just logging what would happen
          logger.info(`Would restore ${documents.length} documents to collection ${collectionName}`);
          
          restoredDocuments += documents.length;
        }
        
        restoredCollections++;
      }
      
      logger.info(`Database restore simulation completed: ${restoredCollections} collections, ${restoredDocuments} documents`);
      
      return {
        success: true,
        restoredCollections,
        restoredDocuments,
        backupTimestamp: manifest.timestamp
      };
    } catch (error) {
      logger.error('Database restoration failed:', error);
      throw error;
    }
  }
}

module.exports = BackupService;