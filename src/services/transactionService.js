const Transaction = require('../models/transactionModel');
const Account = require('../models/accountModel');
const FraudDetectionService = require('./fraudDetectionService');
const NotificationService = require('./notificationService');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');

class TransactionService {
  /**
   * Process a new transaction with proper validation and fraud detection
   * @param {Object} transactionData - Transaction data
   * @param {string} ipAddress - IP address of the request
   * @param {string} userAgent - User agent of the request
   * @returns {Promise<Object>} - Created transaction
   */
  async processTransaction(transactionData, ipAddress, userAgent) {
    // Start a database transaction
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const { 
        sourceAccountId, 
        destinationAccountId, 
        amount, 
        transactionType, 
        description,
        metadata
      } = transactionData;
      
      // Validate the transaction based on its type
      await this._validateTransaction(
        transactionType, 
        sourceAccountId, 
        destinationAccountId, 
        amount
      );
      
      // Create transaction record initially as pending
      const transaction = new Transaction({
        sourceAccountId,
        destinationAccountId,
        amount,
        transactionType,
        description,
        metadata,
        status: 'pending',
        ipAddress,
        userAgent
      });
      
      await transaction.save({ session });
      
      // Perform fraud detection
      const fraudDetectionService = new FraudDetectionService();
      const fraudResult = await fraudDetectionService.analyzeTransaction(transaction);
      
      // Update transaction with fraud score
      transaction.fraudScore = fraudResult.score;
      
      // If the transaction is flagged as potentially fraudulent, keep it pending
      if (fraudResult.score > parseFloat(process.env.FRAUD_ALERT_THRESHOLD || 0.75)) {
        transaction.statusHistory.push({
          status: 'pending',
          timestamp: Date.now(),
          reason: 'High fraud risk detected'
        });
        
        // Create fraud case for high-risk transactions
        await fraudDetectionService.createFraudCase(transaction, fraudResult);
        
        await transaction.save({ session });
        await session.commitTransaction();
        
        // Notify about potential fraud
        await NotificationService.sendFraudAlert(transaction, fraudResult);
        
        logger.warn(`Potential fraud detected: Transaction ${transaction._id} with score ${fraudResult.score}`);
        
        return {
          transaction,
          status: 'pending',
          message: 'Transaction is pending due to additional security verification'
        };
      }
      
      // If fraud score is low, complete the transaction
      if (transactionType === 'transfer') {
        // Process transfer
        await this._processTransfer(
          sourceAccountId, 
          destinationAccountId, 
          amount,
          session
        );
      } else if (transactionType === 'withdrawal') {
        // Process withdrawal
        await this._processWithdrawal(sourceAccountId, amount, session);
      } else if (transactionType === 'deposit') {
        // Process deposit
        await this._processDeposit(destinationAccountId, amount, session);
      } else if (transactionType === 'payment') {
        // Process payment
        await this._processPayment(sourceAccountId, destinationAccountId, amount, session);
      }
      
      // Update transaction status to completed
      transaction.status = 'completed';
      await transaction.save({ session });
      
      // Commit the transaction
      await session.commitTransaction();
      
      // Send transaction notification
      await NotificationService.sendTransactionNotification(transaction);
      
      return {
        transaction,
        status: 'completed',
        message: 'Transaction processed successfully'
      };
      
    } catch (error) {
      // Abort transaction in case of error
      await session.abortTransaction();
      
      logger.error('Transaction processing error:', error);
      
      throw new AppError(
        error.message || 'Failed to process transaction', 
        error.statusCode || 500
      );
    } finally {
      session.endSession();
    }
  }
  
  /**
   * Reverse a completed transaction
   * @param {string} transactionId - ID of the transaction to reverse
   * @param {string} reason - Reason for reversal
   * @param {string} userId - ID of the user requesting the reversal
   * @returns {Promise<Object>} - Reversal transaction
   */
  async reverseTransaction(transactionId, reason, userId) {
    try {
      const Transaction = mongoose.model('Transaction');
      const reversalTransaction = await Transaction.createReversal(transactionId, reason);
      
      // Log the reversal action
      logger.info(`Transaction ${transactionId} reversed by user ${userId}. Reason: ${reason}`);
      
      // Send notification about the reversal
      await NotificationService.sendReversalNotification(reversalTransaction);
      
      return reversalTransaction;
    } catch (error) {
      logger.error(`Transaction reversal error for ID ${transactionId}:`, error);
      throw new AppError(error.message || 'Failed to reverse transaction', 400);
    }
  }
  
  /**
   * Get transaction by ID with fraud assessment
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<Object>} - Transaction with fraud assessment
   */
  async getTransactionWithAssessment(transactionId) {
    const transaction = await Transaction.findById(transactionId)
      .populate('sourceAccountId', 'accountNumber accountType')
      .populate('destinationAccountId', 'accountNumber accountType');
      
    if (!transaction) {
      throw new AppError('Transaction not found', 404);
    }
    
    // Get fraud assessment if available
    let fraudAssessment = null;
    if (transaction.fraudScore > 0) {
      const FraudCase = mongoose.model('FraudCase');
      fraudAssessment = await FraudCase.findOne({ transactionId: transaction._id })
        .select('detectionType fraudScore status description');
    }
    
    return {
      transaction,
      fraudAssessment
    };
  }
  
  /**
   * Generate a signed transaction receipt
   * @param {string} transactionId - Transaction ID
   * @returns {Promise<string>} - Signed transaction receipt
   */
  async generateTransactionReceipt(transactionId) {
    const transaction = await Transaction.findById(transactionId)
      .populate('sourceAccountId', 'accountNumber accountType')
      .populate('destinationAccountId', 'accountNumber accountType');
      
    if (!transaction) {
      throw new AppError('Transaction not found', 404);
    }
    
    if (transaction.status !== 'completed') {
      throw new AppError('Cannot generate receipt for incomplete transaction', 400);
    }
    
    // Create receipt object
    const receipt = {
      transactionId: transaction._id,
      reference: transaction.reference,
      date: transaction.createdAt,
      type: transaction.transactionType,
      amount: transaction.amount,
      currency: transaction.currency,
      description: transaction.description,
      source: transaction.sourceAccountId ? {
        accountNumber: this._maskAccountNumber(transaction.sourceAccountId.accountNumber),
        accountType: transaction.sourceAccountId.accountType
      } : null,
      destination: transaction.destinationAccountId ? {
        accountNumber: this._maskAccountNumber(transaction.destinationAccountId.accountNumber),
        accountType: transaction.destinationAccountId.accountType
      } : null,
      status: transaction.status,
      timestamp: new Date().toISOString()
    };
    
    // Create signature for receipt
    const receiptData = JSON.stringify(receipt);
    const signature = CryptoJS.HmacSHA256(receiptData, process.env.JWT_SECRET).toString();
    
    return {
      receipt,
      signature
    };
  }
  
  // PRIVATE METHODS
  
  /**
   * Validate a transaction before processing
   * @private
   */
  async _validateTransaction(transactionType, sourceAccountId, destinationAccountId, amount) {
    // Validate based on transaction type
    switch (transactionType) {
      case 'transfer':
        if (!sourceAccountId || !destinationAccountId) {
          throw new AppError('Source and destination accounts are required for transfers', 400);
        }
        await this._validateSourceAccount(sourceAccountId, amount);
        await this._validateDestinationAccount(destinationAccountId);
        break;
        
      case 'withdrawal':
        if (!sourceAccountId) {
          throw new AppError('Source account is required for withdrawals', 400);
        }
        await this._validateSourceAccount(sourceAccountId, amount);
        break;
        
      case 'deposit':
        if (!destinationAccountId) {
          throw new AppError('Destination account is required for deposits', 400);
        }
        await this._validateDestinationAccount(destinationAccountId);
        break;
        
      case 'payment':
        if (!sourceAccountId) {
          throw new AppError('Source account is required for payments', 400);
        }
        await this._validateSourceAccount(sourceAccountId, amount);
        break;
        
      default:
        throw new AppError(`Unsupported transaction type: ${transactionType}`, 400);
    }
  }
  
  /**
   * Validate source account for withdrawals
   * @private
   */
  async _validateSourceAccount(accountId, amount) {
    const account = await Account.findById(accountId);
    
    if (!account) {
      throw new AppError('Source account not found', 404);
    }
    
    if (!account.isActive) {
      throw new AppError('Source account is inactive', 400);
    }
    
    if (account.isFrozen) {
      throw new AppError('Source account is frozen', 400);
    }
    
    // Check if account has sufficient funds
    if (account.accountType !== 'credit' && account.availableBalance < amount) {
      throw new AppError('Insufficient funds', 400);
    }
    
    // For credit accounts, check against credit limit
    if (account.accountType === 'credit' && 
        (account.balance - amount) < -account.creditLimit) {
      throw new AppError('Transaction exceeds credit limit', 400);
    }
    
    // Check transaction limits
    if (amount > account.transactionLimits.perTransaction) {
      throw new AppError('Transaction amount exceeds per-transaction limit', 400);
    }
    
    // Check daily limits (would require aggregating transactions for the day)
    // This is simplified for the example
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const dailyTotal = await Transaction.aggregate([
      {
        $match: {
          sourceAccountId: mongoose.Types.ObjectId(accountId),
          status: 'completed',
          createdAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);
    
    const dailyAmount = (dailyTotal[0]?.total || 0) + amount;
    if (dailyAmount > account.transactionLimits.daily) {
      throw new AppError('Transaction would exceed daily limit', 400);
    }
    
    return account;
  }
  
  /**
   * Validate destination account for deposits/transfers
   * @private
   */
  async _validateDestinationAccount(accountId) {
    const account = await Account.findById(accountId);
    
    if (!account) {
      throw new AppError('Destination account not found', 404);
    }
    
    if (!account.isActive) {
      throw new AppError('Destination account is inactive', 400);
    }
    
    if (account.isFrozen) {
      throw new AppError('Destination account is frozen', 400);
    }
    
    return account;
  }
  
  /**
   * Process a transfer between accounts
   * @private
   */
  async _processTransfer(sourceAccountId, destinationAccountId, amount, session) {
    await Account.updateBalances(sourceAccountId, destinationAccountId, amount, 'completed');
  }
  
  /**
   * Process a withdrawal from an account
   * @private
   */
  async _processWithdrawal(sourceAccountId, amount, session) {
    await Account.updateBalances(sourceAccountId, null, amount, 'completed');
  }
  
  /**
   * Process a deposit to an account
   * @private
   */
  async _processDeposit(destinationAccountId, amount, session) {
    await Account.updateBalances(null, destinationAccountId, amount, 'completed');
  }
  
  /**
   * Process a payment
   * @private
   */
  async _processPayment(sourceAccountId, destinationAccountId, amount, session) {
    await Account.updateBalances(sourceAccountId, destinationAccountId, amount, 'completed');
  }
  
  /**
   * Mask account number for security
   * @private
   */
  _maskAccountNumber(accountNumber) {
    if (!accountNumber) return null;
    return accountNumber.slice(0, 4) + '*'.repeat(accountNumber.length - 8) + accountNumber.slice(-4);
  }
}

module.exports = new TransactionService();