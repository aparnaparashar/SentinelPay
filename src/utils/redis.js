const redis = require('redis');
const logger = require('./logger');

let client;
let isConnected = false;

/**
 * Initialize Redis client
 */
const initRedis = async () => {
  try {
    if (!process.env.REDIS_URL) {
      logger.warn('Redis URL not provided, cache will not be available');
      return;
    }
    
    client = redis.createClient({
      url: process.env.REDIS_URL,
    });

    // Redis error handling
    client.on('error', (err) => {
      logger.error('Redis error:', err);
      isConnected = false;
    });
    
    client.on('connect', () => {
      logger.info('Connected to Redis');
      isConnected = true;
    });
    
    client.on('reconnecting', () => {
      logger.info('Reconnecting to Redis...');
      isConnected = false;
    });
    
    await client.connect();
  } catch (err) {
    logger.error('Failed to connect to Redis:', err);
    isConnected = false;
  }
};

// Initialize Redis when this module is imported
initRedis();

/**
 * Set a key-value pair in Redis with optional expiration
 * @param {string} key - The key
 * @param {string|object} value - The value (objects will be stringified)
 * @param {number} [expireSeconds] - Optional expiration time in seconds
 * @returns {Promise<boolean>} - Success status
 */
const set = async (key, value, expireSeconds = null) => {
  try {
    if (!isConnected || !client) {
      return false;
    }
    
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
    
    if (expireSeconds) {
      await client.setEx(key, expireSeconds, stringValue);
    } else {
      await client.set(key, stringValue);
    }
    
    return true;
  } catch (error) {
    logger.error(`Redis set error for key ${key}:`, error);
    return false;
  }
};

/**
 * Get a value from Redis by key
 * @param {string} key - The key
 * @returns {Promise<string|null>} - The value if found, null otherwise
 */
const get = async (key) => {
  try {
    if (!isConnected || !client) {
      return null;
    }
    
    return await client.get(key);
  } catch (error) {
    logger.error(`Redis get error for key ${key}:`, error);
    return null;
  }
};

/**
 * Delete a key from Redis
 * @param {string} key - The key to delete
 * @returns {Promise<boolean>} - Success status
 */
const del = async (key) => {
  try {
    if (!isConnected || !client) {
      return false;
    }
    
    await client.del(key);
    return true;
  } catch (error) {
    logger.error(`Redis delete error for key ${key}:`, error);
    return false;
  }
};

/**
 * Clear all keys with a specific prefix
 * @param {string} prefix - The key prefix to match
 * @returns {Promise<boolean>} - Success status
 */
const clearByPrefix = async (prefix) => {
  try {
    if (!isConnected || !client) {
      return false;
    }
    
    const keys = await client.keys(`${prefix}*`);
    if (keys.length > 0) {
      await client.del(keys);
    }
    
    return true;
  } catch (error) {
    logger.error(`Redis clear by prefix error for prefix ${prefix}:`, error);
    return false;
  }
};

/**
 * Cache middleware for Express routes
 * @param {number} duration - Cache duration in seconds
 * @returns {function} - Express middleware
 */
const cacheMiddleware = (duration = 60) => {
  return async (req, res, next) => {
    if (!isConnected || !client) {
      return next();
    }
    
    // Skip caching for non-GET requests or when cache is explicitly bypassed
    if (req.method !== 'GET' || req.query.noCache) {
      return next();
    }
    
    const key = `cache:${req.originalUrl}`;
    
    try {
      const cachedResponse = await get(key);
      
      if (cachedResponse) {
        const parsedResponse = JSON.parse(cachedResponse);
        return res.status(200).json(parsedResponse);
      }
      
      // Override res.json to cache the response
      const originalJson = res.json;
      res.json = function(body) {
        set(key, JSON.stringify(body), duration);
        return originalJson.call(this, body);
      };
      
      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      next();
    }
  };
};

module.exports = {
  initRedis,
  set,
  get,
  del,
  clearByPrefix,
  cacheMiddleware,
  getClient: () => client,
  isConnected: () => isConnected
};