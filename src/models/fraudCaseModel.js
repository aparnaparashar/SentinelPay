const mongoose = require('mongoose');

const fraudCaseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  accountId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Account'
  },
  transactionId: {
    type: mongoose.Schema.ObjectId,
    ref: 'Transaction'
  },
  detectionType: {
    type: String,
    enum: [
      'unusual-amount', 
      'unusual-location', 
      'unusual-time', 
      'suspicious-pattern',
      'ml-detection',
      'ip-change',
      'multiple-failures',
      'manual-report',
      'other'
    ],
    required: true
  },
  fraudScore: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  evidence: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  status: {
    type: String,
    enum: ['open', 'investigating', 'resolved-genuine', 'resolved-fraud', 'closed'],
    default: 'open'
  },
  assignedTo: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  resolutionNotes: String,
  resolutionDate: Date,
  actions: [{
    actionType: {
      type: String,
      enum: ['account-freeze', 'transaction-reversal', 'customer-contact', 'security-reset', 'other']
    },
    actionDate: {
      type: Date,
      default: Date.now
    },
    actionBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    notes: String
  }],
  customerNotified: {
    type: Boolean,
    default: false
  },
  relatedCases: [{
    type: mongoose.Schema.ObjectId,
    ref: 'FraudCase'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
fraudCaseSchema.index({ userId: 1 });
fraudCaseSchema.index({ accountId: 1 });
fraudCaseSchema.index({ transactionId: 1 });
fraudCaseSchema.index({ status: 1 });
fraudCaseSchema.index({ fraudScore: 1 });
fraudCaseSchema.index({ createdAt: 1 });

// Middleware to send notification when a fraud case is created
fraudCaseSchema.post('save', async function(doc) {
  if (this.isNew && process.env.NODE_ENV !== 'test') {
    try {
      const NotificationService = require('../services/notificationService');
      if (doc.fraudScore > 75) {
        // High priority alert for high-risk cases
        await NotificationService.sendHighPriorityFraudAlert(doc);
      } else {
        // Standard notification for normal cases
        await NotificationService.sendFraudCaseNotification(doc);
      }
    } catch (error) {
      console.error('Error sending fraud case notification:', error);
    }
  }
});

// Create model
const FraudCase = mongoose.model('FraudCase', fraudCaseSchema);

module.exports = FraudCase;