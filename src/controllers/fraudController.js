const FraudCase = require('../models/fraudCaseModel');
const Transaction = require('../models/transactionModel');
const Account = require('../models/accountModel');
const User = require('../models/userModel');
const FraudDetectionService = require('../services/fraudDetectionService');
const NotificationService = require('../services/notificationService');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const mongoose = require('mongoose');

/**
 * Get all fraud cases (admin only)
 */
exports.getFraudCases = async (req, res, next) => {
  try {
    // Build query
    const query = {};
    
    // Apply filters
    if (req.query.status) {
      query.status = req.query.status;
    }
    
    if (req.query.minScore) {
      query.fraudScore = query.fraudScore || {};
      query.fraudScore.$gte = Number(req.query.minScore);
    }
    
    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;
    
    // Execute query
    const fraudCases = await FraudCase.find(query)
      .sort({ createdAt: -1, fraudScore: -1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'firstName lastName email')
      .populate('accountId', 'accountNumber accountType')
      .populate('transactionId', 'reference amount status createdAt')
      .populate('assignedTo', 'firstName lastName email');
    
    // Get total count
    const totalCases = await FraudCase.countDocuments(query);
    
    res.status(200).json({
      status: 'success',
      results: fraudCases.length,
      totalPages: Math.ceil(totalCases / limit),
      currentPage: page,
      data: {
        fraudCases
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single fraud case by ID (admin only)
 */
exports.getFraudCase = async (req, res, next) => {
  try {
    const fraudCase = await FraudCase.findById(req.params.id)
      .populate('userId', 'firstName lastName email phoneNumber')
      .populate('accountId', 'accountNumber accountType balance')
      .populate('transactionId')
      .populate('assignedTo', 'firstName lastName email')
      .populate('actions.actionBy', 'firstName lastName');
    
    if (!fraudCase) {
      return next(new AppError('Fraud case not found', 404));
    }
    
    // Get related transactions
    let relatedTransactions = [];
    if (fraudCase.transactionId) {
      // Get transactions from the same account in a 24-hour window
      const transaction = await Transaction.findById(fraudCase.transactionId);
      
      if (transaction) {
        const timeBefore = new Date(transaction.createdAt);
        timeBefore.setHours(timeBefore.getHours() - 12);
        
        const timeAfter = new Date(transaction.createdAt);
        timeAfter.setHours(timeAfter.getHours() + 12);
        
        relatedTransactions = await Transaction.find({
          $or: [
            { sourceAccountId: transaction.sourceAccountId },
            { destinationAccountId: transaction.sourceAccountId }
          ],
          _id: { $ne: transaction._id },
          createdAt: { $gte: timeBefore, $lte: timeAfter }
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .select('reference amount transactionType status createdAt');
      }
    }
    
    res.status(200).json({
      status: 'success',
      data: {
        fraudCase,
        relatedTransactions
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a fraud case (admin only)
 */
exports.updateFraudCase = async (req, res, next) => {
  try {
    const { status, assignedTo, resolutionNotes } = req.body;
    
    const fraudCase = await FraudCase.findById(req.params.id);
    
    if (!fraudCase) {
      return next(new AppError('Fraud case not found', 404));
    }
    
    // Update fields
    if (status) {
      fraudCase.status = status;
      
      // If resolving the case as fraud, freeze the account
      if (status === 'resolved-fraud' && fraudCase.accountId) {
        const account = await Account.findById(fraudCase.accountId);
        if (account) {
          account.isFrozen = true;
          await account.save();
          
          // Add action to freeze account
          fraudCase.actions.push({
            actionType: 'account-freeze',
            actionBy: req.user._id,
            notes: 'Account automatically frozen due to confirmed fraud'
          });
          
          // Notify user of account freeze
          await NotificationService.sendAccountFrozenNotification(account, fraudCase);
        }
      }
    }
    
    if (assignedTo) {
      // Verify assignee exists and is an admin/manager
      const assignee = await User.findById(assignedTo);
      if (!assignee || (assignee.role !== 'admin' && assignee.role !== 'manager')) {
        return next(new AppError('Invalid assignee - must be admin or manager', 400));
      }
      
      fraudCase.assignedTo = assignedTo;
    }
    
    if (resolutionNotes) {
      fraudCase.resolutionNotes = resolutionNotes;
    }
    
    // If status is changing to resolved or closed, add resolution date
    if ((status === 'resolved-genuine' || status === 'resolved-fraud' || status === 'closed') 
         && fraudCase.status !== status) {
      fraudCase.resolutionDate = Date.now();
    }
    
    await fraudCase.save();
    
    res.status(200).json({
      status: 'success',
      data: {
        fraudCase
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add an action to a fraud case (admin only)
 */
exports.addFraudCaseAction = async (req, res, next) => {
  try {
    const { actionType, notes } = req.body;
    
    if (!actionType) {
      return next(new AppError('Action type is required', 400));
    }
    
    const fraudCase = await FraudCase.findById(req.params.id);
    
    if (!fraudCase) {
      return next(new AppError('Fraud case not found', 404));
    }
    
    // Add the action
    const action = {
      actionType,
      actionBy: req.user._id,
      actionDate: Date.now(),
      notes: notes || ''
    };
    
    fraudCase.actions.push(action);
    
    // Handle special actions
    if (actionType === 'account-freeze' && fraudCase.accountId) {
      // Freeze account
      const account = await Account.findById(fraudCase.accountId);
      if (account) {
        account.isFrozen = true;
        await account.save();
        
        // Notify user
        await NotificationService.sendAccountFrozenNotification(account, fraudCase);
      }
    } else if (actionType === 'customer-contact') {
      // Mark customer as notified
      fraudCase.customerNotified = true;
    } else if (actionType === 'transaction-reversal' && fraudCase.transactionId) {
      // Get the transaction
      const transaction = await Transaction.findById(fraudCase.transactionId);
      
      if (transaction && transaction.status === 'completed') {
        // Reverse the transaction
        await Transaction.createReversal(
          transaction._id, 
          `Reversed due to fraud case #${fraudCase._id}`
        );
      }
    }
    
    await fraudCase.save();
    
    res.status(200).json({
      status: 'success',
      message: 'Action added successfully',
      data: {
        action: fraudCase.actions[fraudCase.actions.length - 1]
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * User-reported fraud
 */
exports.reportFraud = async (req, res, next) => {
  try {
    const { transactionId, description, additionalDetails } = req.body;
    
    if (!transactionId || !description) {
      return next(new AppError('Transaction ID and description are required', 400));
    }
    
    // Find the transaction
    const transaction = await Transaction.findById(transactionId);
    
    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }
    
    // Check if user has access to this transaction
    const userAccounts = await Account.find({ userId: req.user.id });
    const userAccountIds = userAccounts.map(acc => acc._id.toString());
    
    const hasSourceAccount = transaction.sourceAccountId && 
      userAccountIds.includes(transaction.sourceAccountId.toString());
    
    const hasDestAccount = transaction.destinationAccountId && 
      userAccountIds.includes(transaction.destinationAccountId.toString());
    
    if (!hasSourceAccount && !hasDestAccount) {
      return next(new AppError('You do not have access to this transaction', 403));
    }
    
    // Check if a fraud case already exists for this transaction
    let fraudCase = await FraudCase.findOne({ transactionId });
    
    if (fraudCase) {
      // Update existing case
      fraudCase.status = 'investigating';
      fraudCase.actions.push({
        actionType: 'customer-contact',
        actionBy: req.user._id,
        notes: `Customer reported: ${description}`
      });
      
      if (additionalDetails) {
        fraudCase.evidence = {
          ...fraudCase.evidence,
          userReport: {
            reportedAt: new Date(),
            description,
            additionalDetails
          }
        };
      }
      
      await fraudCase.save();
    } else {
      // Create new fraud case
      let accountId;
      if (hasSourceAccount) {
        accountId = transaction.sourceAccountId;
      } else if (hasDestAccount) {
        accountId = transaction.destinationAccountId;
      }
      
      fraudCase = new FraudCase({
        userId: req.user.id,
        accountId,
        transactionId,
        detectionType: 'manual-report',
        fraudScore: 90, // High score for user reports
        description: `User reported fraud: ${description}`,
        evidence: {
          userReport: {
            reportedAt: new Date(),
            description,
            additionalDetails
          },
          transactionDetails: {
            amount: transaction.amount,
            type: transaction.transactionType,
            timestamp: transaction.createdAt
          }
        },
        status: 'open',
        customerNotified: true
      });
      
      await fraudCase.save();
      
      // Update transaction
      transaction.fraudScore = 90;
      transaction.fraudReviewed = true;
      await transaction.save();
    }
    
    // Notify admin team
    await NotificationService.sendFraudReportNotification(fraudCase, req.user);
    
    res.status(201).json({
      status: 'success',
      message: 'Fraud report submitted successfully. Our team will investigate.',
      data: {
        caseReference: fraudCase._id,
        reportedAt: new Date()
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get fraud statistics summary (admin only)
 */
exports.getFraudSummary = async (req, res, next) => {
  try {
    // Get date ranges
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfYesterday = new Date(yesterday.setHours(0, 0, 0, 0));
    
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    // Aggregate fraud cases by time period
    const todayCases = await FraudCase.countDocuments({ createdAt: { $gte: startOfDay } });
    const yesterdayCases = await FraudCase.countDocuments({
      createdAt: { $gte: startOfYesterday, $lt: startOfDay }
    });
    const weekCases = await FraudCase.countDocuments({ createdAt: { $gte: startOfWeek } });
    const monthCases = await FraudCase.countDocuments({ createdAt: { $gte: startOfMonth } });
    
    // Get cases by status
    const statusCounts = await FraudCase.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const statusSummary = statusCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});
    
    // Get high-risk cases (fraud score > 80)
    const highRiskCases = await FraudCase.countDocuments({ fraudScore: { $gt: 80 } });
    
    // Get cases by detection type
    const detectionTypeCounts = await FraudCase.aggregate([
      {
        $group: {
          _id: '$detectionType',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const detectionSummary = detectionTypeCounts.reduce((acc, curr) => {
      acc[curr._id] = curr.count;
      return acc;
    }, {});
    
    // Get average resolution time (for resolved cases)
    const resolutionTimeAgg = await FraudCase.aggregate([
      {
        $match: {
          status: { $in: ['resolved-fraud', 'resolved-genuine', 'closed'] },
          resolutionDate: { $exists: true }
        }
      },
      {
        $project: {
          resolutionTime: {
            $divide: [
              { $subtract: ['$resolutionDate', '$createdAt'] },
              1000 * 60 * 60 // Convert to hours
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          avgResolutionTime: { $avg: '$resolutionTime' }
        }
      }
    ]);
    
    const avgResolutionTimeHours = resolutionTimeAgg.length > 0
      ? resolutionTimeAgg[0].avgResolutionTime
      : 0;
    
    res.status(200).json({
      status: 'success',
      data: {
        periodSummary: {
          today: todayCases,
          yesterday: yesterdayCases,
          thisWeek: weekCases,
          thisMonth: monthCases
        },
        statusSummary,
        detectionSummary,
        highRiskCases,
        avgResolutionTimeHours
      }
    });
  } catch (error) {
    next(error);
  }
};