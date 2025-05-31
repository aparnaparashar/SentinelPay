const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'Account must belong to a user']
  },
  accountNumber: {
    type: String,
    unique: true,
    required: [true, 'Account number is required']
  },
  accountType: {
    type: String,
    enum: ['checking', 'savings', 'investment', 'credit'],
    required: [true, 'Account type is required']
  },
  balance: {
    type: Number,
    required: [true, 'Balance is required'],
    default: 0,
    validate: {
      validator: function(val) {
        if (this.accountType === 'credit') {
          return val >= -this.creditLimit;
        }
        return val >= 0;
      },
      message: 'Invalid balance for account type'
    }
  },
  availableBalance: {
    type: Number,
    default: function() {
      return this.balance;
    }
  },
  pendingTransactions: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    enum: ['USD', 'EUR', 'GBP', 'JPY', 'CAD'],
    default: 'USD'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFrozen: {
    type: Boolean,
    default: false
  },
  creditLimit: {
    type: Number,
    default: 0
  },
  interestRate: {
    type: Number,
    default: 0
  },
  lastActivityDate: {
    type: Date,
    default: Date.now
  },
  closedAt: Date,
  closureReason: String,
  overdraftProtection: {
    type: Boolean,
    default: false
  },
  overdraftLinkedAccount: {
    type: mongoose.Schema.ObjectId,
    ref: 'Account'
  },
  transactionLimits: {
    daily: {
      type: Number,
      default: 10000
    },
    perTransaction: {
      type: Number,
      default: 5000
    }
  },
  riskScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
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

// Indexes
accountSchema.index({ userId: 1 });
accountSchema.index({ isActive: 1 });

// Virtual populate for transactions
accountSchema.virtual('transactions', {
  ref: 'Transaction',
  foreignField: 'sourceAccountId',
  localField: '_id'
});

// Middleware to generate account number before saving
accountSchema.pre('save', async function(next) {
  if (this.isNew) {
    if (!this.accountNumber) {
      const prefix = {
        checking: '1000',
        savings: '2000',
        investment: '3000',
        credit: '4000'
      }[this.accountType] || '9000';
      
      const randomPart = Math.floor(10000000 + Math.random() * 90000000);
      this.accountNumber = `${prefix}${randomPart}`;
    }
    
    this.availableBalance = this.balance;
  }
  next();
});

// Middleware to implement soft delete
accountSchema.pre(/^find/, function(next) {
  if (!this.getQuery().includeSoftDeleted) {
    this.find({ isDeleted: { $ne: true } });
  }
  next();
});

// Static method to update account balances after a transaction
accountSchema.statics.updateBalances = async function(
  sourceAccountId, 
  destinationAccountId, 
  amount, 
  status
) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    if (status === 'completed') {
      if (sourceAccountId) {
        const sourceAccount = await this.findById(sourceAccountId).session(session);
        if (sourceAccount) {
          sourceAccount.balance -= amount;
          sourceAccount.availableBalance = sourceAccount.balance - sourceAccount.pendingTransactions;
          sourceAccount.lastActivityDate = Date.now();
          await sourceAccount.save({ session });
        }
      }
      
      if (destinationAccountId) {
        const destAccount = await this.findById(destinationAccountId).session(session);
        if (destAccount) {
          destAccount.balance += amount;
          destAccount.availableBalance = destAccount.balance - destAccount.pendingTransactions;
          destAccount.lastActivityDate = Date.now();
          await destAccount.save({ session });
        }
      }
    } else if (status === 'pending') {
      if (sourceAccountId) {
        const sourceAccount = await this.findById(sourceAccountId).session(session);
        if (sourceAccount) {
          sourceAccount.pendingTransactions += amount;
          sourceAccount.availableBalance = sourceAccount.balance - sourceAccount.pendingTransactions;
          await sourceAccount.save({ session });
        }
      }
    } else if (status === 'failed' || status === 'reversed') {
      if (sourceAccountId) {
        const sourceAccount = await this.findById(sourceAccountId).session(session);
        if (sourceAccount) {
          sourceAccount.pendingTransactions -= amount;
          sourceAccount.availableBalance = sourceAccount.balance - sourceAccount.pendingTransactions;
          await sourceAccount.save({ session });
        }
      }
    }
    
    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Create model
const Account = mongoose.model('Account', accountSchema);

module.exports = Account;