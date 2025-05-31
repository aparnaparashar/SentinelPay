const Transaction = require('../models/transactionModel');
const Account = require('../models/accountModel');
const User = require('../models/userModel');
const TransactionService = require('../services/transactionService');
const FraudDetectionService = require('../services/fraudDetectionService');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

/**
 * Create a new transaction
 */
exports.createTransaction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Ensure user has access to the source account if provided
    if (req.body.sourceAccountId) {
      const sourceAccount = await Account.findById(req.body.sourceAccountId);
      
      if (!sourceAccount) {
        return next(new AppError('Source account not found', 404));
      }
      
      if (sourceAccount.userId.toString() !== userId) {
        return next(new AppError('You do not have access to this account', 403));
      }
    }
    
    // Process the transaction
    const result = await TransactionService.processTransaction(
      req.body,
      req.ip || req.connection.remoteAddress,
      req.headers['user-agent']
    );
    
    res.status(201).json({
      status: 'success',
      data: {
        transaction: result.transaction,
        message: result.message
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get transactions for a user
 */
exports.getTransactions = async (req, res, next) => {
  try {
    // Build query
    const query = {};
    const userId = req.user.id;
    
    // Find all accounts belonging to the user
    const accounts = await Account.find({ userId });
    const accountIds = accounts.map(account => account._id);
    
    // Find transactions where user's accounts are either source or destination
    query.$or = [
      { sourceAccountId: { $in: accountIds } },
      { destinationAccountId: { $in: accountIds } }
    ];
    
    // Apply filters
    if (req.query.accountId) {
      // Ensure user has access to this account
      const hasAccount = accounts.some(acc => acc._id.toString() === req.query.accountId);
      if (!hasAccount) {
        return next(new AppError('You do not have access to this account', 403));
      }
      
      query.$or = [
        { sourceAccountId: req.query.accountId },
        { destinationAccountId: req.query.accountId }
      ];
    }
    
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    if (req.query.type) {
      query.transactionType = req.query.type;
    }
    
    if (req.query.minAmount) {
      query.amount = query.amount || {};
      query.amount.$gte = Number(req.query.minAmount);
    }
    
    if (req.query.maxAmount) {
      query.amount = query.amount || {};
      query.amount.$lte = Number(req.query.maxAmount);
    }
    
    if (req.query.startDate) {
      query.createdAt = query.createdAt || {};
      query.createdAt.$gte = new Date(req.query.startDate);
    }
    
    if (req.query.endDate) {
      query.createdAt = query.createdAt || {};
      query.createdAt.$lte = new Date(req.query.endDate);
    }
    
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;
    
    // Sorting
    let sort = { createdAt: -1 }; // Default: newest first
    if (req.query.sort && req.query.order) {
      sort = { [req.query.sort]: req.query.order === 'asc' ? 1 : -1 };
    }
    
    // Execute query
    const transactions = await Transaction.find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('sourceAccountId', 'accountNumber accountType')
      .populate('destinationAccountId', 'accountNumber accountType');
    
    // Get total count for pagination
    const totalTransactions = await Transaction.countDocuments(query);
    
    res.status(200).json({
      status: 'success',
      results: transactions.length,
      totalPages: Math.ceil(totalTransactions / limit),
      currentPage: page,
      data: {
        transactions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single transaction
 */
exports.getTransaction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Find the transaction
    const transaction = await Transaction.findById(req.params.id)
      .populate('sourceAccountId', 'accountNumber accountType userId')
      .populate('destinationAccountId', 'accountNumber accountType userId');
    
    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }
    
    // Check if the user has access to this transaction
    const userAccounts = await Account.find({ userId });
    const userAccountIds = userAccounts.map(acc => acc._id.toString());
    
    const hasSourceAccount = transaction.sourceAccountId && 
      userAccountIds.includes(transaction.sourceAccountId._id.toString());
    
    const hasDestAccount = transaction.destinationAccountId && 
      userAccountIds.includes(transaction.destinationAccountId._id.toString());
    
    if (!hasSourceAccount && !hasDestAccount) {
      return next(new AppError('You do not have access to this transaction', 403));
    }
    
    // Get fraud assessment if available
    let fraudAssessment = null;
    if (transaction.fraudScore > 0) {
      const FraudCase = require('../models/fraudCaseModel');
      fraudAssessment = await FraudCase.findOne({ transactionId: transaction._id })
        .select('detectionType fraudScore status');
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        transaction,
        fraudAssessment
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get transaction receipt
 */
exports.getTransactionReceipt = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // First check if user has access to this transaction
    const transaction = await Transaction.findById(req.params.id)
      .populate('sourceAccountId', 'accountNumber accountType userId')
      .populate('destinationAccountId', 'accountNumber accountType userId');
    
    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }
    
    // Verify user has access to this transaction
    const userAccounts = await Account.find({ userId });
    const userAccountIds = userAccounts.map(acc => acc._id.toString());
    
    const hasSourceAccount = transaction.sourceAccountId && 
      userAccountIds.includes(transaction.sourceAccountId._id.toString());
    
    const hasDestAccount = transaction.destinationAccountId && 
      userAccountIds.includes(transaction.destinationAccountId._id.toString());
    
    if (!hasSourceAccount && !hasDestAccount) {
      return next(new AppError('You do not have access to this transaction', 403));
    }
    
    // Generate receipt
    const receipt = await TransactionService.generateTransactionReceipt(req.params.id);
    
    res.status(200).json({
      status: 'success',
      data: receipt
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reverse a transaction
 */
exports.reverseTransaction = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;
    
    if (!reason) {
      return next(new AppError('Reason for reversal is required', 400));
    }
    
    // Find the transaction
    const transaction = await Transaction.findById(req.params.id);
    
    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }
    
    // Check transaction status
    if (transaction.status !== 'completed') {
      return next(new AppError('Only completed transactions can be reversed', 400));
    }
    
    // Check if user has admin rights or owns the source account
    const isAdmin = req.user.role === 'admin' || req.user.role === 'manager';
    
    if (!isAdmin) {
      const userAccounts = await Account.find({ userId });
      const userAccountIds = userAccounts.map(acc => acc._id.toString());
      
      if (!transaction.sourceAccountId || 
          !userAccountIds.includes(transaction.sourceAccountId.toString())) {
        return next(new AppError('You do not have permission to reverse this transaction', 403));
      }
    }
    
    // Reverse the transaction
    const reversalTransaction = await TransactionService.reverseTransaction(
      transaction._id,
      reason,
      userId
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Transaction reversed successfully',
      data: {
        originalTransaction: transaction,
        reversalTransaction
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Analyze a transaction for fraud risk
 */
exports.analyzeTransaction = async (req, res, next) => {
  try {
    const { transactionData } = req.body;
    
    // Ensure user has access to the account
    if (transactionData.sourceAccountId) {
      const sourceAccount = await Account.findById(transactionData.sourceAccountId);
      
      if (!sourceAccount) {
        return next(new AppError('Source account not found', 404));
      }
      
      if (sourceAccount.userId.toString() !== req.user.id) {
        return next(new AppError('You do not have access to this account', 403));
      }
    }
    
    // Create a temporary transaction object for analysis
    const tempTransaction = new Transaction({
      ...transactionData,
      status: 'pending',
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    });
    
    // Analyze transaction using FraudDetectionService
    const fraudDetectionService = new FraudDetectionService();
    const analysisResult = await fraudDetectionService.analyzeTransaction(tempTransaction);
    
    // Add user-friendly risk assessment
    let riskLevel = 'low';
    if (analysisResult.score > 0.75) riskLevel = 'high';
    else if (analysisResult.score > 0.5) riskLevel = 'medium';
    
    const response = {
      status: 'success',
      data: {
        riskScore: analysisResult.score,
        riskLevel,
        indicators: analysisResult.indicators || {},
        recommendations: []
      }
    };
    
    // Add recommendations based on risk level
    if (analysisResult.score > 0.75) {
      response.data.recommendations.push(
        'This transaction has a high risk level and may be flagged for review.',
        'Consider using a trusted device or contact customer support.'
      );
    } else if (analysisResult.score > 0.5) {
      response.data.recommendations.push(
        'This transaction has a moderate risk level.',
        'Verify the transaction details before proceeding.'
      );
    } else {
      response.data.recommendations.push(
        'This transaction appears to be legitimate.',
        'It should process normally without additional verification.'
      );
    }
    
    res.status(200).json(response);
  } catch (error) {
    next(error);
  }
};