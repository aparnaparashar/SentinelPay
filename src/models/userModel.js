const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 8,
    select: false // Don't include in query results by default
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  phoneNumber: {
    type: String,
    trim: true
  },
  role: {
    type: String,
    enum: ['user', 'admin', 'manager'],
    default: 'user'
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: {
    type: String,
    select: false
  },
  lastTwoFactorVerification: {
    type: Date
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  lastLoginAt: Date,
  lastLoginIp: String,
  loginAttempts: {
    type: Number,
    default: 0
  },
  accountLocked: {
    type: Boolean,
    default: false
  },
  accountLockedUntil: Date,
  isActive: {
    type: Boolean,
    default: true
  },
  deviceFingerprints: [{
    fingerprint: String,
    device: String,
    browser: String,
    os: String,
    lastSeen: Date,
    trusted: {
      type: Boolean,
      default: false
    }
  }],
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual populate for accounts
userSchema.virtual('accounts', {
  ref: 'Account',
  foreignField: 'userId',
  localField: '_id'
});

// Middleware: Hash password before saving
userSchema.pre('save', async function(next) {
  // Only run this function if password was modified
  if (!this.isModified('password')) return next();
  
  // Hash the password with a salt of 12
  this.password = await bcrypt.hash(
    this.password, 
    parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12
  );
  
  if (this.isNew) {
    // For new users, don't set passwordChangedAt
    return next();
  }
  
  // Update passwordChangedAt field
  this.passwordChangedAt = Date.now() - 1000; // subtract 1 second to account for processing delays
  next();
});

// Middleware: Set isActive to false for deleted documents
userSchema.pre(/^findOneAnd/, async function(next) {
  this.r = await this.clone().findOne();
  next();
});

userSchema.post(/^findOneAnd/, function() {
  // We need to use this.r because the query has already been executed
  if (this.r) {
    this.r.constructor.calcAccountsCount(this.r.id);
  }
});

// Instance Methods
userSchema.methods.correctPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.hasPasswordChangedAfter = function(timestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return timestamp < changedTimestamp;
  }
  return false;
};

userSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
  
  // Token expires in 10 minutes
  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;
  
  return resetToken;
};

userSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
  
  // Token expires in 24 hours
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
  
  return verificationToken;
};

userSchema.methods.recordLoginAttempt = function(successful, ipAddress) {
  if (successful) {
    this.loginAttempts = 0;
    this.lastLoginAt = Date.now();
    this.lastLoginIp = ipAddress;
    this.accountLocked = false;
    this.accountLockedUntil = undefined;
  } else {
    this.loginAttempts += 1;
    
    // Lock account after 5 failed attempts
    if (this.loginAttempts >= 5) {
      this.accountLocked = true;
      // Lock for 30 minutes
      this.accountLockedUntil = Date.now() + 30 * 60 * 1000;
    }
  }
};

// Static Methods
userSchema.statics.calcAccountsCount = async function(userId) {
  const stats = await this.model('Account').aggregate([
    {
      $match: { userId: mongoose.Types.ObjectId(userId) }
    },
    {
      $group: {
        _id: '$userId',
        nAccounts: { $sum: 1 }
      }
    }
  ]);
};

// Create model
const User = mongoose.model('User', userSchema);

module.exports = User;