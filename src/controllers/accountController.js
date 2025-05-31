const Account = require('../models/accountModel');
const User = require('../models/userModel');
const Transaction = require('../models/transactionModel');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

/**
 * Create a new account for the authenticated user
 */
exports.createAccount = async (req, res, next) => {
  try {
    const { accountType, currency, initialBalance } = req.body;
    
    // Add user ID to request body
    req.body.userId = req.user.id;
    
    // Create new account
    const account = new Account({
      userId: req.user.id,
      accountType,
      currency: currency || 'USD',
      balance: initialBalance || 0,
      isActive: true
    });
    
    // Special handling for credit accounts
    if (accountType === 'credit') {
      // In a real application, we would perform a credit check here
      // For this example, we'll set a default credit limit
      account.creditLimit = 5000; // $50 default
    }
    
    // Save account
    await account.save();
    
    // If initial balance > 0, create a deposit transaction
    if (initialBalance && initialBalance > 0) {
      const depositTransaction = new Transaction({
        destinationAccountId: account._id,
        amount: initialBalance,
        currency: currency || 'USD',
        transactionType: 'deposit',
        status: 'completed',
        description: 'Initial deposit',
      });
      
      await depositTransaction.save();
    }
    
    res.status(201).json({
      status: 'success',
      data: {
        account
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all accounts for the authenticated user
 */
exports.getAccounts = async (req, res, next) => {
  try {
    // Build query
    const query = { userId: req.user.id };
    
    // Apply filters
    if (req.query.isActive) {
      query.isActive = req.query.isActive === 'true';
    }
    
    if (req.query.accountType) {
      query.accountType = req.query.accountType;
    }
    
    // Get accounts
    const accounts = await Account.find(query);
    
    res.status(200).json({
      status: 'success',
      results: accounts.length,
      data: {
        accounts
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific account by ID
 */
exports.getAccount = async (req, res, next) => {
  try {
    const account = await Account.findById(req.params.id);
    
    if (!account) {
      return next(new AppError('Account not found', 404));
    }
    
    // Check if account belongs to user
    if (account.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('You do not have access to this account', 403));
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        account
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update account details
 */
exports.updateAccount = async (req, res, next) => {
  try {
    // Find account
    const account = await Account.findById(req.params.id);
    
    if (!account) {
      return next(new AppError('Account not found', 404));
    }
    
    // Check if account belongs to user
    if (account.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('You do not have access to this account', 403));
    }
    
    // Only allow updating certain fields
    const allowedFields = ['isActive', 'overdraftProtection', 'overdraftLinkedAccount'];
    
    // For admins, allow more fields
    if (req.user.role === 'admin') {
      allowedFields.push('isFrozen', 'transactionLimits', 'creditLimit', 'interestRate');
    }
    
    // Filter out non-allowed fields
    const filteredBody = {};
    Object.keys(req.body).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredBody[key] = req.body[key];
      }
    });
    
    // Update account
    const updatedAccount = await Account.findByIdAndUpdate(
      req.params.id,
      filteredBody,
      {
        new: true,
        runValidators: true
      }
    );
    
    // Log the account update
    logger.info(`Account ${updatedAccount._id} updated by user ${req.user.id}`);
    
    res.status(200).json({
      status: 'success',
      data: {
        account: updatedAccount
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Close account
 */
exports.closeAccount = async (req, res, next) => {
  try {
    // Find account
    const account = await Account.findById(req.params.id);
    
    if (!account) {
      return next(new AppError('Account not found', 404));
    }
    
    // Check if account belongs to user
    if (account.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('You do not have access to this account', 403));
    }
    
    // Check if account has zero balance
    if (account.balance !== 0) {
      return next(
        new AppError('Account must have zero balance to close', 400)
      );
    }
    
    // Check for pending transactions
    const pendingTransactions = await Transaction.countDocuments({
      $or: [
        { sourceAccountId: account._id },
        { destinationAccountId: account._id }
      ],
      status: 'pending'
    });
    
    if (pendingTransactions > 0) {
      return next(
        new AppError('Cannot close account with pending transactions', 400)
      );
    }
    
    // Update account
    account.isActive = false;
    account.closedAt = Date.now();
    account.closureReason = req.body.reason || 'User requested closure';
    
    await account.save();
    
    // Log the account closure
    logger.info(`Account ${account._id} closed by user ${req.user.id}. Reason: ${account.closureReason}`);
    
    res.status(200).json({
      status: 'success',
      data: {
        account
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get account balance history
 */
exports.getBalanceHistory = async (req, res, next) => {
  try {
    // Find account
    const account = await Account.findById(req.params.id);
    
    if (!account) {
      return next(new AppError('Account not found', 404));
    }
    
    // Check if account belongs to user
    if (account.userId.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new AppError('You do not have access to this account', 403));
    }
    
    // Determine time range
    const period = req.query.period || 'month';
    let startDate;
    const endDate = new Date();
    
    switch (period) {
      case 'week':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        break;
      case 'year':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 365);
        break;
      default:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
    }
    
    // Get all transactions for this account in the time range
    const transactions = await Transaction.find({
      $or: [
        { sourceAccountId: account._id },
        { destinationAccountId: account._id }
      ],
      status: 'completed',
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).sort({ createdAt: 1 });
    
    // Calculate balance over time
    const balanceHistory = [];
    let runningBalance = account.balance;
    
    // Work backwards through transactions to calculate historical balances
    // (Starting from current balance and reversing the effect of each transaction)
    for (let i = transactions.length - 1; i >= 0; i--) {
      const transaction = transactions[i];
      
      if (transaction.destinationAccountId && 
          transaction.destinationAccountId.toString() === account._id.toString()) {
        // This was an incoming transaction, so subtract the amount
        runningBalance -= transaction.amount;
      } else if (transaction.sourceAccountId && 
                transaction.sourceAccountId.toString() === account._id.toString()) {
        // This was an outgoing transaction, so add the amount back
        runningBalance += transaction.amount;
      }
      
      balanceHistory.unshift({
        date: transaction.createdAt,
        balance: runningBalance,
        transaction: {
          id: transaction._id,
          type: transaction.transactionType,
          amount: transaction.amount,
          reference: transaction.reference
        }
      });
    }
    
    // Add current balance at current time
    balanceHistory.push({
      date: new Date(),
      balance: account.balance,
      current: true
    });
    
    res.status(200).json({
      status: 'success',
      data: {
        account: {
          id: account._id,
          accountNumber: account.accountNumber,
          accountType: account.accountType,
          currentBalance: account.balance
        },
        balanceHistory,
        period
      }
    });
  } catch (error) {
    next(error);
  }
};