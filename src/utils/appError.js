/**
 * Custom error class for application-specific errors
 * Extends the built-in Error class with additional properties
 */
class AppError extends Error {
  /**
   * Create a new AppError
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code
   */
  constructor(message, statusCode) {
    super(message);
    
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Flag to identify operational errors
    
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;