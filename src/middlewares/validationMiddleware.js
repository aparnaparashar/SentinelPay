const { body, param, query, validationResult } = require('express-validator');
const AppError = require('../utils/appError');
const logger = require('../utils/logger');

// Helper to process validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => `${err.path}: ${err.msg}`).join(', ');
    logger.warn(`Validation failed: ${errorMessages}`);
    return next(new AppError(`Validation failed: ${errorMessages}`, 400));
  }
  next();
};

// Common validation rules
const commonValidation = {
  // User validation
  userIdParam: param('id')
    .isMongoId().withMessage('Invalid user ID format'),
    
  userCreateRules: [
    body('email')
      .isEmail().withMessage('Please provide a valid email')
      .normalizeEmail()
      .trim(),
    body('password')
      .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
      .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*])/).withMessage('Password must contain at least one number, one uppercase letter, one lowercase letter, and one special character'),
    body('firstName')
      .notEmpty().withMessage('First name is required')
      .isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters')
      .trim(),
    body('lastName')
      .notEmpty().withMessage('Last name is required')
      .isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters')
      .trim(),
    body('phoneNumber')
      .optional()
      .isMobilePhone().withMessage('Please provide a valid phone number')
  ],
  
  // Account validation
  accountIdParam: param('id')
    .isMongoId().withMessage('Invalid account ID format'),
    
  accountCreateRules: [
    body('accountType')
      .isIn(['checking', 'savings', 'investment', 'credit']).withMessage('Account type must be checking, savings, investment, or credit'),
    body('currency')
      .optional()
      .isIn(['USD', 'EUR', 'GBP', 'JPY', 'CAD']).withMessage('Currency must be USD, EUR, GBP, JPY, or CAD'),
    body('initialBalance')
      .optional()
      .isFloat({ min: 0 }).withMessage('Initial balance must be a positive number')
  ],
  
  // Transaction validation
  transactionIdParam: param('id')
    .isMongoId().withMessage('Invalid transaction ID format'),
    
  transactionCreateRules: [
    body('sourceAccountId')
      .isMongoId().withMessage('Invalid source account ID format'),
    body('destinationAccountId')
      .optional()
      .isMongoId().withMessage('Invalid destination account ID format'),
    body('amount')
      .isFloat({ gt: 0 }).withMessage('Amount must be greater than 0'),
    body('transactionType')
      .isIn(['deposit', 'withdrawal', 'transfer', 'payment', 'refund']).withMessage('Transaction type must be deposit, withdrawal, transfer, payment, or refund'),
    body('description')
      .optional()
      .isLength({ max: 255 }).withMessage('Description must be less than 255 characters')
      .trim()
  ]
};

// Validation middleware factory functions
exports.validateUserCreate = [
  ...commonValidation.userCreateRules,
  handleValidationErrors
];

exports.validateUserUpdate = [
  body('email')
    .optional()
    .isEmail().withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('firstName')
    .optional()
    .isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters')
    .trim(),
  body('lastName')
    .optional()
    .isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters')
    .trim(),
  body('phoneNumber')
    .optional()
    .isMobilePhone().withMessage('Please provide a valid phone number'),
  handleValidationErrors
];

exports.validateAccountCreate = [
  ...commonValidation.accountCreateRules,
  handleValidationErrors
];

exports.validateAccountUpdate = [
  body('isActive')
    .optional()
    .isBoolean().withMessage('isActive must be a boolean'),
  handleValidationErrors
];

exports.validateTransactionCreate = [
  ...commonValidation.transactionCreateRules,
  handleValidationErrors
];

exports.validatePasswordChange = [
  body('currentPassword')
    .notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[!@#$%^&*])/).withMessage('Password must contain at least one number, one uppercase letter, one lowercase letter, and one special character'),
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match password');
      }
      return true;
    }),
  handleValidationErrors
];

// ML-specific validation middleware
exports.validateMLPredictionRequest = [
  body('transactionData')
    .notEmpty().withMessage('Transaction data is required')
    .isObject().withMessage('Transaction data must be an object'),
  body('transactionData.amount')
    .isFloat({ gt: 0 }).withMessage('Transaction amount must be greater than 0'),
  body('transactionData.accountId')
    .isMongoId().withMessage('Invalid account ID format'),
  body('transactionData.transactionType')
    .isIn(['deposit', 'withdrawal', 'transfer', 'payment', 'refund']).withMessage('Invalid transaction type'),
  handleValidationErrors
];

// Sanitize and validate all request parameters
exports.sanitizeParams = (req, res, next) => {
  // Convert MongoDB IDs to string and trim
  if (req.params) {
    Object.keys(req.params).forEach(key => {
      if (typeof req.params[key] === 'string') {
        req.params[key] = req.params[key].trim();
      }
    });
  }
  
  // Sanitize query parameters
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key].trim();
      }
    });
  }
  
  next();
};