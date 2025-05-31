const FraudCase = require('../models/fraudCaseModel');
const Transaction = require('../models/transactionModel');
const Account = require('../models/accountModel');
const User = require('../models/userModel');
const tfModel = require('../ml/fraudDetectionModel');
const logger = require('../utils/logger');
const NotificationService = require('./notificationService');
const redis = require('../utils/redis');

class FraudDetectionService {
  /**
   * Analyze a transaction for potential fraud
   * @param {Object} transaction - Transaction object to analyze
   * @returns {Promise<Object>} - Analysis result with fraud score
   */
  async analyzeTransaction(transaction) {
    try {
      // Step 1: Check for basic fraud indicators
      const basicIndicators = await this._checkBasicFraudIndicators(transaction);
      
      // Step 2: Use ML model for advanced detection
      const mlScore = await this._getMLPrediction(transaction);
      
      // Step 3: Combine scores with weighted approach
      // 40% basic indicators, 60% ML model
      const combinedScore = (basicIndicators.score * 0.4) + (mlScore * 0.6);
      
      // Create detailed result object
      const result = {
        score: combinedScore,
        mlScore,
        basicScore: basicIndicators.score,
        indicators: basicIndicators.indicators,
        isHighRisk: combinedScore > parseFloat(process.env.FRAUD_ALERT_THRESHOLD || 0.75),
        timestamp: new Date().toISOString()
      };
      
      // Cache result for quick future reference
      await redis.set(
        `fraud_analysis:${transaction._id}`, 
        JSON.stringify(result),
        60 * 60 * 24 // Cache for 24 hours
      );
      
      return result;
    } catch (error) {
      logger.error('Error in fraud detection analysis:', error);
      // Return a default score in case of error
      return {
        score: 0.5, // Moderate risk when we can't properly assess
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * Run a daily fraud detection scan on recent transactions
   * @returns {Promise<Object>} - Scan results
   */
  async runDailyScan() {
    logger.info('Starting daily fraud detection scan');
    
    try {
      // Get transactions from the last 24 hours that haven't been fraud reviewed
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      
      const transactions = await Transaction.find({
        createdAt: { $gte: oneDayAgo },
        fraudReviewed: false
      });
      
      logger.info(`Found ${transactions.length} transactions to scan for fraud`);
      
      const suspiciousTransactions = [];
      
      // Analyze each transaction
      for (const transaction of transactions) {
        const fraudResult = await this.analyzeTransaction(transaction);
        
        // Update transaction with fraud score
        transaction.fraudScore = fraudResult.score;
        await transaction.save();
        
        // If suspicious, add to list and create fraud case
        if (fraudResult.isHighRisk) {
          suspiciousTransactions.push({
            transaction,
            fraudResult
          });
          
          // Create fraud case
          await this.createFraudCase(transaction, fraudResult);
        }
      }
      
      // Send notification with daily scan results
      if (suspiciousTransactions.length > 0) {
        await NotificationService.sendDailyScanAlert(suspiciousTransactions);
      }
      
      return {
        scannedTransactions: transactions.length,
        suspiciousCount: suspiciousTransactions.length,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error in daily fraud scan:', error);
      throw error;
    }
  }
  
  /**
   * Create a fraud case for investigation
   * @param {Object} transaction - Transaction object
   * @param {Object} fraudResult - Fraud analysis result
   * @returns {Promise<Object>} - Created fraud case
   */
  async createFraudCase(transaction, fraudResult) {
    try {
      // Determine detection type based on indicators
      let detectionType = 'ml-detection';
      
      if (fraudResult.indicators) {
        if (fraudResult.indicators.unusualAmount) {
          detectionType = 'unusual-amount';
        } else if (fraudResult.indicators.locationChange) {
          detectionType = 'unusual-location';
        } else if (fraudResult.indicators.unusualTime) {
          detectionType = 'unusual-time';
        } else if (fraudResult.indicators.multipleFailures) {
          detectionType = 'multiple-failures';
        } else if (fraudResult.indicators.suspiciousPattern) {
          detectionType = 'suspicious-pattern';
        }
      }
      
      // Get user ID from source account
      let userId, accountId;
      
      if (transaction.sourceAccountId) {
        const account = await Account.findById(transaction.sourceAccountId);
        if (account) {
          accountId = account._id;
          userId = account.userId;
        }
      } else if (transaction.destinationAccountId) {
        const account = await Account.findById(transaction.destinationAccountId);
        if (account) {
          accountId = account._id;
          userId = account.userId;
        }
      }
      
      // Create fraud case
      const fraudCase = new FraudCase({
        userId,
        accountId,
        transactionId: transaction._id,
        detectionType,
        fraudScore: fraudResult.score * 100, // Convert to 0-100 scale
        description: this._generateFraudDescription(transaction, fraudResult),
        evidence: {
          transactionDetails: {
            amount: transaction.amount,
            type: transaction.transactionType,
            timestamp: transaction.createdAt
          },
          fraudAnalysis: fraudResult,
          ipAddress: transaction.ipAddress,
          userAgent: transaction.userAgent
        }
      });
      
      await fraudCase.save();
      
      // Update transaction to link to the fraud case
      transaction.fraudReviewed = true;
      await transaction.save();
      
      // Send notification for high-risk cases
      if (fraudResult.score > 0.9) {
        await NotificationService.sendHighPriorityFraudAlert(fraudCase);
      }
      
      return fraudCase;
    } catch (error) {
      logger.error('Error creating fraud case:', error);
      // Don't throw - we don't want to block the transaction process
      return null;
    }
  }
  
  // PRIVATE METHODS
  
  /**
   * Check for basic fraud indicators
   * @private
   * @param {Object} transaction - Transaction to check
   * @returns {Promise<Object>} - Basic fraud indicators with score
   */
  async _checkBasicFraudIndicators(transaction) {
    const indicators = {};
    let score = 0;
    
    try {
      // 1. Check for unusual transaction amount
      const isUnusualAmount = await this._isUnusualAmount(transaction);
      if (isUnusualAmount) {
        indicators.unusualAmount = true;
        score += 0.3; // Significant impact on score
      }
      
      // 2. Check for unusual location/IP address
      if (transaction.ipAddress) {
        const isLocationChange = await this._isLocationChange(transaction);
        if (isLocationChange) {
          indicators.locationChange = true;
          score += 0.2;
        }
      }
      
      // 3. Check for unusual transaction time
      const isUnusualTime = await this._isUnusualTime(transaction);
      if (isUnusualTime) {
        indicators.unusualTime = true;
        score += 0.15;
      }
      
      // 4. Check for multiple failed transaction attempts
      const hasMultipleFailures = await this._checkFailedAttempts(transaction);
      if (hasMultipleFailures) {
        indicators.multipleFailures = true;
        score += 0.25;
      }
      
      // 5. Check for suspicious transaction pattern
      const hasSuspiciousPattern = await this._checkSuspiciousPattern(transaction);
      if (hasSuspiciousPattern) {
        indicators.suspiciousPattern = true;
        score += 0.35;
      }
      
      // Normalize score to 0-1 range
      score = Math.min(score, 1);
      
      return { 
        indicators,
        score,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error checking basic fraud indicators:', error);
      return { 
        indicators: {},
        score: 0.2, // Assign a moderate risk score when checks fail
        error: error.message
      };
    }
  }
  
  /**
   * Check if transaction amount is unusual for the account
   * @private
   */
  async _isUnusualAmount(transaction) {
    try {
      if (!transaction.sourceAccountId) return false;
      
      const threshold = parseFloat(process.env.UNUSUAL_TRANSACTION_THRESHOLD || 5000);
      
      // Simple threshold check
      if (transaction.amount > threshold) {
        return true;
      }
      
      // Get account average transaction amount
      const recentTransactions = await Transaction.find({
        sourceAccountId: transaction.sourceAccountId,
        status: 'completed',
        createdAt: { 
          $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
        }
      }).select('amount');
      
      if (recentTransactions.length > 5) {
        const avgAmount = recentTransactions.reduce((sum, t) => sum + t.amount, 0) / recentTransactions.length;
        // If transaction amount is 300% more than average, flag as unusual
        return transaction.amount > avgAmount * 3;
      }
      
      return false;
    } catch (error) {
      logger.error('Error in unusual amount detection:', error);
      return false;
    }
  }
  
  /**
   * Check if transaction is from an unusual location
   * @private
   */
  async _isLocationChange(transaction) {
    try {
      // Get account owner
      const account = await Account.findById(transaction.sourceAccountId);
      if (!account) return false;
      
      const user = await User.findById(account.userId);
      if (!user) return false;
      
      // Compare current IP with last login IP
      if (user.lastLoginIp && transaction.ipAddress &&
          user.lastLoginIp !== transaction.ipAddress) {
        // In a real system, we would use IP geolocation to determine distance
        return true; // Simplified - any IP change is suspicious
      }
      
      return false;
    } catch (error) {
      logger.error('Error in location change detection:', error);
      return false;
    }
  }
  
  /**
   * Check if transaction is at an unusual time
   * @private
   */
  async _isUnusualTime(transaction) {
    try {
      // Check if transaction is happening during late night hours (1 AM - 5 AM)
      const hour = transaction.createdAt.getHours();
      if (hour >= 1 && hour <= 5) {
        return true;
      }
      
      return false;
    } catch (error) {
      logger.error('Error in unusual time detection:', error);
      return false;
    }
  }
  
  /**
   * Check for multiple failed transaction attempts
   * @private
   */
  async _checkFailedAttempts(transaction) {
    try {
      // Look for failed transactions in the last hour
      const oneHourAgo = new Date();
      oneHourAgo.setHours(oneHourAgo.getHours() - 1);
      
      const failedCount = await Transaction.countDocuments({
        sourceAccountId: transaction.sourceAccountId,
        status: 'failed',
        createdAt: { $gte: oneHourAgo }
      });
      
      // If there are 3 or more failed attempts in the last hour
      return failedCount >= 3;
    } catch (error) {
      logger.error('Error in failed attempts detection:', error);
      return false;
    }
  }
  
  /**
   * Check for suspicious transaction patterns
   * @private
   */
  async _checkSuspiciousPattern(transaction) {
    try {
      // Look for suspicious patterns like multiple transactions in quick succession
      const thirtyMinutesAgo = new Date();
      thirtyMinutesAgo.setMinutes(thirtyMinutesAgo.getMinutes() - 30);
      
      const recentTransactions = await Transaction.countDocuments({
        sourceAccountId: transaction.sourceAccountId,
        createdAt: { $gte: thirtyMinutesAgo }
      });
      
      // If there are 5 or more transactions in the last 30 minutes
      if (recentTransactions >= 5) {
        return true;
      }
      
      // Check for multiple small transactions followed by a large one
      if (transaction.amount > 1000) { // Large transaction
        const smallTransactionsCount = await Transaction.countDocuments({
          sourceAccountId: transaction.sourceAccountId,
          amount: { $lt: 100 }, // Small transaction
          createdAt: { $gte: thirtyMinutesAgo }
        });
        
        if (smallTransactionsCount >= 3) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Error in suspicious pattern detection:', error);
      return false;
    }
  }
  
  /**
   * Get ML model prediction for fraud detection
   * @private
   * @param {Object} transaction - Transaction to analyze
   * @returns {Promise<number>} - Fraud score from ML model (0-1)
   */
  async _getMLPrediction(transaction) {
    try {
      // Check if model is available
      if (!process.env.FRAUD_DETECTION_ENABLED || 
          process.env.FRAUD_DETECTION_ENABLED.toLowerCase() !== 'true') {
        return 0; // No ML detection if disabled
      }
      
      // Prepare features for ML model
      const features = await this._prepareTransactionFeatures(transaction);
      
      // Use TensorFlow.js model for prediction
      const prediction = await tfModel.predict(features);
      
      // Return the fraud probability (0-1)
      return prediction;
    } catch (error) {
      logger.error('Error in ML fraud prediction:', error);
      return 0.2; // Default moderate risk when ML fails
    }
  }
  
  /**
   * Prepare transaction features for ML model
   * @private
   * @param {Object} transaction - Transaction to prepare features for
   * @returns {Promise<Array>} - Feature vector for ML model
   */
  async _prepareTransactionFeatures(transaction) {
    // In a real implementation, this would extract and normalize
    // various features from the transaction and related data
    
    try {
      const account = transaction.sourceAccountId ? 
        await Account.findById(transaction.sourceAccountId) :
        await Account.findById(transaction.destinationAccountId);
      
      if (!account) {
        throw new Error('Account not found');
      }
      
      // Get user's transaction history stats
      const user = await User.findById(account.userId);
      
      if (!user) {
        throw new Error('User not found');
      }
      
      // Get user's recent transaction statistics
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentTransactions = await Transaction.find({
        $or: [
          { sourceAccountId: account._id },
          { destinationAccountId: account._id }
        ],
        createdAt: { $gte: thirtyDaysAgo }
      });
      
      // Calculate transaction statistics
      const avgAmount = recentTransactions.length > 0 ?
        recentTransactions.reduce((sum, t) => sum + t.amount, 0) / recentTransactions.length : 0;
      
      const stdDevAmount = this._calculateStdDev(
        recentTransactions.map(t => t.amount), 
        avgAmount
      );
      
      // Normalized features
      const features = [
        transaction.amount / 10000, // Normalize amount
        transaction.transactionType === 'transfer' ? 1 : 0,
        transaction.transactionType === 'withdrawal' ? 1 : 0,
        transaction.transactionType === 'deposit' ? 1 : 0,
        transaction.transactionType === 'payment' ? 1 : 0,
        recentTransactions.length / 100, // Normalize transaction count
        avgAmount / 10000, // Normalize average amount
        stdDevAmount / 10000, // Normalize standard deviation
        transaction.amount > avgAmount * 2 ? 1 : 0, // Amount is significantly higher than avg
        transaction.amount < 10 ? 1 : 0, // Very small amount
        new Date().getHours() / 24, // Time of day normalized
        (new Date().getDay() === 0 || new Date().getDay() === 6) ? 1 : 0 // Weekend flag
      ];
      
      return features;
    } catch (error) {
      logger.error('Error preparing transaction features:', error);
      // Return default features if preparation fails
      return [
        transaction.amount / 10000,
        transaction.transactionType === 'transfer' ? 1 : 0,
        transaction.transactionType === 'withdrawal' ? 1 : 0,
        transaction.transactionType === 'deposit' ? 1 : 0,
        transaction.transactionType === 'payment' ? 1 : 0,
        0.1, // Default normalized transaction count
        0.1, // Default normalized average amount
        0.1, // Default normalized standard deviation
        0,   // Amount is not significantly higher than avg
        transaction.amount < 10 ? 1 : 0,
        new Date().getHours() / 24,
        (new Date().getDay() === 0 || new Date().getDay() === 6) ? 1 : 0
      ];
    }
  }
  
  /**
   * Calculate standard deviation
   * @private
   */
  _calculateStdDev(values, avg) {
    if (values.length === 0) return 0;
    
    const squareDiffs = values.map(value => {
      const diff = value - avg;
      return diff * diff;
    });
    
    const avgSquareDiff = squareDiffs.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
  }
  
  /**
   * Generate a human-readable fraud description
   * @private
   */
  _generateFraudDescription(transaction, fraudResult) {
    const indicators = fraudResult.indicators || {};
    let description = 'Potential fraudulent activity detected: ';
    
    if (indicators.unusualAmount) {
      description += 'Unusual transaction amount. ';
    }
    
    if (indicators.locationChange) {
      description += 'Transaction from unusual location. ';
    }
    
    if (indicators.unusualTime) {
      description += 'Transaction at unusual time. ';
    }
    
    if (indicators.multipleFailures) {
      description += 'Multiple failed transaction attempts. ';
    }
    
    if (indicators.suspiciousPattern) {
      description += 'Suspicious transaction pattern. ';
    }
    
    if (Object.keys(indicators).length === 0) {
      description += 'ML model detected potential fraud. ';
    }
    
    return description;
  }
}

module.exports = FraudDetectionService;