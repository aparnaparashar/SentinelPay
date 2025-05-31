const mongoose = require('mongoose');
const crypto = require('crypto');

const transactionSchema = new mongoose.Schema({
  reference: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(16).toString('hex')
  },
  sourceAccountId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Account',
    required: function() {
      return this.transactionType !== 'deposit';
    }
  },
  destinationAccountId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Account',
    required: function() {
      return this.transactionType === 'transfer';
    }
  },
  amount: {
    type: Number,
    required: [true, 'Transaction amount is required'],
    validate: {
      validator: function(val) {
        return val > 0;
      },
      message: 'Amount must be greater than 0'
    }
  },
  currency: {
    type: String,
    enum: ['USD', 'EUR', 'GBP', 'JPY', 'CAD'],
    default: 'USD'
  },
  exchangeRate: {
    type: Number,
    default: 1
  },
  fees: {
    type: Number,
    default: 0
  },
  transactionType: {
    type: String,
    enum: ['deposit', 'withdrawal', 'transfer', 'payment', 'refund'],
    required: [true, 'Transaction type is required']
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'reversed'],
    default: 'pending'
  },
  statusHistory: [{
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'reversed']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    reason: String
  }],
  description: {
    type: String,
    trim: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: String,
  userAgent: String,
  deviceFingerprint: String,
  fraudScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  fraudReviewed: {
    type: Boolean,
    default: false
  },
  fraudReviewerId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  reversalReason: String,
  relatedTransactions: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Transaction'
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
transactionSchema.index({ sourceAccountId: 1 });
transactionSchema.index({ destinationAccountId: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: 1 });
transactionSchema.index({ fraudScore: 1 });

// Middleware to implement soft delete
transactionSchema.pre(/^find/, function(next) {
  if (!this.getQuery().includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// Add status change to history
transactionSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('status')) {
    this.statusHistory.push({
      status: this.status,
      timestamp: Date.now()
    });
  }
  next();
});

// After saving, update account balances
transactionSchema.post('save', async function() {
  if (this.status === 'completed' || this.status === 'pending' || 
      this.status === 'failed' || this.status === 'reversed') {
    try {
      const Account = this.model('Account');
      await Account.updateBalances(
        this.sourceAccountId,
        this.destinationAccountId,
        this.amount,
        this.status
      );
      
      // Check for large transactions and send alerts
      if (this.status === 'completed' && this.amount >= 5000) {
        const NotificationService = require('../services/notificationService');
        await NotificationService.sendTransactionNotification(this);
      }
    } catch (error) {
      console.error('Failed to update account balances:', error);
    }
  }
});

// Static method to create a reversal transaction
transactionSchema.statics.createReversal = async function(originalTransactionId, reason) {
  const originalTransaction = await this.findById(originalTransactionId);
  
  if (!originalTransaction) {
    throw new Error('Original transaction not found');
  }
  
  if (originalTransaction.status !== 'completed') {
    throw new Error('Only completed transactions can be reversed');
  }
  
  const reversalTransaction = new this({
    sourceAccountId: originalTransaction.destinationAccountId,
    destinationAccountId: originalTransaction.sourceAccountId,
    amount: originalTransaction.amount,
    currency: originalTransaction.currency,
    transactionType: 'refund',
    description: `Reversal for transaction ${originalTransaction.reference}`,
    reversalReason: reason,
    relatedTransactions: [originalTransaction._id]
  });
  
  originalTransaction.status = 'reversed';
  originalTransaction.reversalReason = reason;
  originalTransaction.relatedTransactions.push(reversalTransaction._id);
  
  await originalTransaction.save();
  return await reversalTransaction.save();
};

// Create model
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;