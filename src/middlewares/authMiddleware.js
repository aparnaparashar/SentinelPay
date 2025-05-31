const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/userModel');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');
const { validateToken } = require('../services/authService');
const { rateLimit } = require('express-rate-limit');
const redis = require('../utils/redis');
const ipBasedDetection = require('../ml/ipBasedDetection');

/**
 * JWT authentication middleware
 */
exports.protect = async (req, res, next) => {
  try {
    // 1) Get token and check if it exists
    let token;
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(
        new AppError('You are not logged in. Please log in to get access', 401)
      );
    }

    // 2) Verify token
    const decodedToken = await validateToken(token);
    
    // 3) Check if user still exists
    const currentUser = await User.findById(decodedToken.id);
    if (!currentUser) {
      return next(
        new AppError('The user belonging to this token no longer exists', 401)
      );
    }

    // 4) Check if user changed password after token was issued
    if (currentUser.hasPasswordChangedAfter(decodedToken.iat)) {
      return next(
        new AppError('User recently changed password. Please log in again', 401)
      );
    }

    // 5) Check if token has been blacklisted
    const isBlacklisted = await redis.get(`blacklist_${token}`);
    if (isBlacklisted) {
      return next(new AppError('Invalid token. Please log in again', 401));
    }

    // 6) Check for suspicious IP (ML-based detection)
    const ipAddress = req.ip || req.connection.remoteAddress;
    const ipRiskScore = await ipBasedDetection.assessIpRisk(ipAddress, currentUser.id);
    
    if (ipRiskScore > 0.8) { // High risk threshold
      logger.warn(`High risk IP detected: ${ipAddress} for user ${currentUser.id} with score ${ipRiskScore}`);
      // For high-risk IPs, we could implement additional verification
      // but for now we'll just log it and allow the request
    }
    
    // Add user and IP risk score to request
    req.user = currentUser;
    req.ipRiskScore = ipRiskScore;
    
    next();
  } catch (err) {
    logger.error(`Auth error: ${err.message}`);
    next(new AppError('Authentication failed. Please log in again', 401));
  }
};

/**
 * Authorization middleware to restrict access based on user roles
 */
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError('You do not have permission to perform this action', 403)
      );
    }
    next();
  };
};

/**
 * API key authentication for service-to-service communication
 */
exports.apiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return next(new AppError('API key is missing', 401));
    }
    
    // Check API key against stored keys
    const service = await redis.get(`apikey_${apiKey}`);
    if (!service) {
      return next(new AppError('Invalid API key', 401));
    }
    
    // Add service info to request
    req.service = JSON.parse(service);
    
    next();
  } catch (err) {
    next(new AppError('API key authentication failed', 401));
  }
};

/**
 * Rate limiting middleware
 */
exports.rateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes by default
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again later'
  }
});

/**
 * 2FA verification middleware
 */
exports.verify2FA = async (req, res, next) => {
  try {
    const { userId, token } = req.body;
    
    if (!userId || !token) {
      return next(new AppError('2FA token and user ID are required', 400));
    }
    
    const user = await User.findById(userId);
    if (!user || !user.twoFactorSecret) {
      return next(new AppError('User not found or 2FA not set up', 404));
    }
    
    const speakeasy = require('speakeasy');
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token: token
    });
    
    if (!verified) {
      return next(new AppError('Invalid 2FA token', 401));
    }
    
    // Update last verification time
    user.lastTwoFactorVerification = Date.now();
    await user.save();
    
    next();
  } catch (err) {
    next(new AppError('2FA verification failed', 401));
  }
};