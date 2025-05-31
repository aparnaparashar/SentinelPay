const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { promisify } = require('util');
const User = require('../models/userModel');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const speakeasy = require('speakeasy');
const redis = require('../utils/redis');
const ipDetection = require('../ml/ipBasedDetection');
const { sendEmail } = require('../utils/email');

// Helper function to create and send JWT
const createSendToken = (user, statusCode, req, res) => {
  // Create token
  const token = jwt.sign(
    { id: user._id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  
  // Create refresh token
  const refreshToken = jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN }
  );
  
  // Store refresh token in Redis
  redis.set(
    `refresh_${user._id}_${refreshToken}`, 
    'valid', 
    7 * 24 * 60 * 60 // 7 days
  );
  
  // Remove password from output
  user.password = undefined;
  
  res.status(statusCode).json({
    status: 'success',
    token,
    refreshToken,
    data: {
      user
    }
  });
};

/**
 * User registration handler
 */
exports.signup = async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phoneNumber } = req.body;
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new AppError('Email already in use', 400));
    }
    
    // Create new user
    const newUser = await User.create({
      email,
      password,
      firstName,
      lastName,
      phoneNumber,
      emailVerified: false
    });
    
    // Generate email verification token
    const verificationToken = newUser.createEmailVerificationToken();
    await newUser.save({ validateBeforeSave: false });
    
    // Send verification email
    const verificationURL = `${req.protocol}://${req.get('host')}/api/auth/verify-email/${verificationToken}`;
    
    try {
      await sendEmail({
        email: newUser.email,
        subject: 'Please verify your email address',
        message: `Welcome to SentinelPay! Please verify your email by clicking on this link: ${verificationURL}`
      });
      
      // Send success response without sending JWT yet (require email verification)
      res.status(201).json({
        status: 'success',
        message: 'User created successfully. Please verify your email address.'
      });
    } catch (error) {
      // If email sending fails, don't block registration but log the error
      logger.error('Error sending verification email:', error);
      
      // Reset verification token
      newUser.emailVerificationToken = undefined;
      newUser.emailVerificationExpires = undefined;
      await newUser.save({ validateBeforeSave: false });
      
      // Continue with registration but notify about email issue
      createSendToken(newUser, 201, req, res);
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Email verification handler
 */
exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.params;
    
    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Find user with this token
    const user = await User.findOne({
      emailVerificationToken: hashedToken,
      emailVerificationExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return next(new AppError('Invalid or expired verification token', 400));
    }
    
    // Update user
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    
    // Redirect to frontend or send success response
    res.status(200).json({
      status: 'success',
      message: 'Email verified successfully. You can now log in.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * User login handler
 */
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Check if email and password exist
    if (!email || !password) {
      return next(new AppError('Please provide email and password', 400));
    }
    
    // Get user and include the password field (which is normally excluded)
    const user = await User.findOne({ email }).select('+password');
    
    // Get IP address
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    // Check if IP is blacklisted
    const isBlacklisted = await ipDetection.isIpBlacklisted(ipAddress);
    if (isBlacklisted) {
      // Record the attempt but don't tell user the IP is blacklisted
      logger.warn(`Login attempt from blacklisted IP: ${ipAddress} for email ${email}`);
      return next(new AppError('Invalid credentials', 401));
    }
    
    // Check if user exists & password is correct
    if (!user || !(await user.correctPassword(password, user.password))) {
      // Record failed login attempt
      await ipDetection.recordFailedLoginAttempt(ipAddress);
      
      if (user) {
        // Update failed login attempts for this user
        user.recordLoginAttempt(false, ipAddress);
        await user.save({ validateBeforeSave: false });
      }
      
      return next(new AppError('Invalid credentials', 401));
    }
    
    // Check if account is locked
    if (user.accountLocked) {
      // Check if lock time has expired
      if (user.accountLockedUntil && user.accountLockedUntil > Date.now()) {
        const minutes = Math.ceil((user.accountLockedUntil - Date.now()) / (1000 * 60));
        return next(
          new AppError(`Account locked due to multiple failed attempts. Try again in ${minutes} minutes.`, 401)
        );
      } else {
        // Reset lock if time has expired
        user.accountLocked = false;
        user.accountLockedUntil = undefined;
        user.loginAttempts = 0;
      }
    }
    
    // Check if email is verified
    if (!user.emailVerified) {
      return next(
        new AppError('Email not verified. Please check your email for verification link.', 401)
      );
    }
    
    // Record successful login
    user.recordLoginAttempt(true, ipAddress);
    await user.save({ validateBeforeSave: false });
    
    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      // Generate temporary token for 2FA verification
      const tempToken = jwt.sign(
        { id: user._id, temp: true },
        process.env.JWT_SECRET,
        { expiresIn: '10m' }
      );
      
      return res.status(200).json({
        status: 'success',
        message: '2FA verification required',
        tempToken,
        requiresTwoFactor: true
      });
    }
    
    // If no 2FA, log in the user
    createSendToken(user, 200, req, res);
  } catch (error) {
    next(error);
  }
};

/**
 * Verify 2FA token
 */
exports.verifyTwoFactor = async (req, res, next) => {
  try {
    const { tempToken, twoFactorCode } = req.body;
    
    if (!tempToken || !twoFactorCode) {
      return next(new AppError('Please provide token and 2FA code', 400));
    }
    
    // Verify temporary token
    const decoded = await promisify(jwt.verify)(tempToken, process.env.JWT_SECRET);
    
    // Check if token is a temporary token
    if (!decoded.temp) {
      return next(new AppError('Invalid token', 401));
    }
    
    // Find user
    const user = await User.findById(decoded.id).select('+twoFactorSecret');
    
    if (!user || !user.twoFactorSecret) {
      return next(new AppError('User not found or 2FA not set up', 401));
    }
    
    // Verify 2FA code
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: twoFactorCode
    });
    
    if (!verified) {
      return next(new AppError('Invalid 2FA code', 401));
    }
    
    // Update last verification time
    user.lastTwoFactorVerification = Date.now();
    await user.save({ validateBeforeSave: false });
    
    // Create and send actual token
    createSendToken(user, 200, req, res);
  } catch (error) {
    next(error);
  }
};

/**
 * Logout handler
 */
exports.logout = async (req, res, next) => {
  try {
    // Get the token from authorization header
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return next(new AppError('No token provided', 400));
    }
    
    // Add current token to blacklist with expiry
    try {
      // Decode token to get expiration time
      const decoded = jwt.decode(token);
      
      if (!decoded || !decoded.exp) {
        throw new Error('Invalid token');
      }
      
      // Calculate time until token expires (in seconds)
      const expiryTime = decoded.exp - Math.floor(Date.now() / 1000);
      
      // Add token to blacklist in Redis
      await redis.set(`blacklist_${token}`, 'true', expiryTime > 0 ? expiryTime : 3600);
      
      // If refresh token is provided, invalidate it too
      if (req.body.refreshToken) {
        await redis.del(`refresh_${decoded.id}_${req.body.refreshToken}`);
      }
      
      res.status(200).json({
        status: 'success',
        message: 'Logged out successfully'
      });
    } catch (error) {
      logger.error('Error during logout:', error);
      return next(new AppError('Error during logout', 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh token handler
 */
exports.refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return next(new AppError('Refresh token is required', 400));
    }
    
    // Verify refresh token
    const decoded = await promisify(jwt.verify)(
      refreshToken, 
      process.env.JWT_REFRESH_SECRET
    );
    
    // Check if token is in Redis (valid)
    const isValid = await redis.get(`refresh_${decoded.id}_${refreshToken}`);
    
    if (!isValid) {
      return next(new AppError('Invalid refresh token', 401));
    }
    
    // Check if user exists
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return next(new AppError('User not found', 401));
    }
    
    // Generate new access token
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );
    
    // Send new access token
    res.status(200).json({
      status: 'success',
      token
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Password reset request handler
 */
exports.forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return next(new AppError('Please provide your email', 400));
    }
    
    // Find user by email
    const user = await User.findOne({ email });
    
    if (!user) {
      // For security reasons, still return success even if email doesn't exist
      return res.status(200).json({
        status: 'success',
        message: 'Password reset link sent to email'
      });
    }
    
    // Generate password reset token
    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });
    
    // Create reset URL
    const resetURL = `${req.protocol}://${req.get('host')}/api/auth/reset-password/${resetToken}`;
    
    try {
      // Send reset email
      await sendEmail({
        email: user.email,
        subject: 'Password Reset Request',
        message: `You requested a password reset. Please use the following link to reset your password: ${resetURL}\nThis link is valid for 10 minutes.`
      });
      
      res.status(200).json({
        status: 'success',
        message: 'Password reset link sent to email'
      });
    } catch (error) {
      // If email fails, reset the token
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });
      
      logger.error('Error sending reset email:', error);
      return next(new AppError('Error sending reset email. Please try again.', 500));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Password reset handler
 */
exports.resetPassword = async (req, res, next) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;
    
    // Check if passwords match
    if (password !== confirmPassword) {
      return next(new AppError('Passwords do not match', 400));
    }
    
    // Hash the token to compare with stored hash
    const hashedToken = crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
    
    // Find user with this token
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return next(new AppError('Invalid or expired reset token', 400));
    }
    
    // Set new password
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    
    // Update passwordChangedAt property
    user.passwordChangedAt = Date.now();
    
    await user.save();
    
    // Send success response (don't log in automatically)
    res.status(200).json({
      status: 'success',
      message: 'Password reset successful. Please log in with your new password.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Setup 2FA handler
 */
exports.setupTwoFactor = async (req, res, next) => {
  try {
    // Generate new 2FA secret
    const secret = speakeasy.generateSecret({
      name: `SentinelPay:${req.user.email}`
    });
    
    // Save secret to user (not yet enabled)
    req.user.twoFactorSecret = secret.base32;
    await req.user.save({ validateBeforeSave: false });
    
    // Return secret and QR code URL
    res.status(200).json({
      status: 'success',
      data: {
        secret: secret.base32,
        otpAuthUrl: secret.otpauth_url
      },
      message: 'Two-factor authentication setup initiated. Verify with a token to complete setup.'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verify and enable 2FA
 */
exports.enableTwoFactor = async (req, res, next) => {
  try {
    const { token } = req.body;
    
    // Get user with 2FA secret
    const user = await User.findById(req.user._id).select('+twoFactorSecret');
    
    if (!user || !user.twoFactorSecret) {
      return next(new AppError('Two-factor authentication not set up', 400));
    }
    
    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token
    });
    
    if (!verified) {
      return next(new AppError('Invalid authentication token', 400));
    }
    
    // Enable 2FA
    user.twoFactorEnabled = true;
    await user.save({ validateBeforeSave: false });
    
    res.status(200).json({
      status: 'success',
      message: 'Two-factor authentication enabled successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Disable 2FA
 */
exports.disableTwoFactor = async (req, res, next) => {
  try {
    const { token, password } = req.body;
    
    // Verify password
    const user = await User.findById(req.user._id).select('+password +twoFactorSecret');
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    if (!user.twoFactorEnabled) {
      return next(new AppError('Two-factor authentication is not enabled', 400));
    }
    
    const isPasswordCorrect = await user.correctPassword(password, user.password);
    
    if (!isPasswordCorrect) {
      return next(new AppError('Incorrect password', 401));
    }
    
    // Verify token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token
    });
    
    if (!verified) {
      return next(new AppError('Invalid authentication token', 401));
    }
    
    // Disable 2FA
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save({ validateBeforeSave: false });
    
    res.status(200).json({
      status: 'success',
      message: 'Two-factor authentication disabled successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Change password handler
 */
exports.updatePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // Check if passwords match
    if (newPassword !== confirmPassword) {
      return next(new AppError('New passwords do not match', 400));
    }
    
    // Get user with password
    const user = await User.findById(req.user._id).select('+password');
    
    if (!user) {
      return next(new AppError('User not found', 404));
    }
    
    // Check if current password is correct
    const isPasswordCorrect = await user.correctPassword(currentPassword, user.password);
    
    if (!isPasswordCorrect) {
      return next(new AppError('Current password is incorrect', 401));
    }
    
    // Update password
    user.password = newPassword;
    user.passwordChangedAt = Date.now();
    await user.save();
    
    // Create and send new JWT
    createSendToken(user, 200, req, res);
  } catch (error) {
    next(error);
  }
};