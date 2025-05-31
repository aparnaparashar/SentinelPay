const redis = require('../utils/redis');
const logger = require('../utils/logger');
const User = require('../models/userModel');

/**
 * Assess the risk level of an IP address for a specific user
 * @param {string} ipAddress - The IP address to assess
 * @param {string} userId - The user ID
 * @returns {Promise<number>} - Risk score between 0 and 1
 */
async function assessIpRisk(ipAddress, userId) {
  try {
    // Check if IP is already in user's trusted devices
    const user = await User.findById(userId);
    if (!user) {
      logger.warn(`IP risk assessment requested for non-existent user: ${userId}`);
      return 0.5; // Medium risk for unknown user
    }
    
    // Check if IP is in trusted devices
    const isKnownDevice = user.deviceFingerprints.some(device => 
      device.fingerprint.includes(ipAddress) && device.trusted
    );
    
    if (isKnownDevice) {
      return 0.1; // Low risk for trusted device
    }
    
    // Check IP reputation in Redis cache
    const cachedRisk = await redis.get(`ip_risk:${ipAddress}`);
    if (cachedRisk !== null) {
      return parseFloat(cachedRisk);
    }
    
    // Check if this is the first login from this IP for this user
    const isFirstLogin = !user.lastLoginIp || user.lastLoginIp !== ipAddress;
    
    // Check if there have been failed login attempts from this IP
    const failedLoginKey = `failed_login:${ipAddress}`;
    const failedLogins = await redis.get(failedLoginKey);
    const failedLoginCount = failedLogins ? parseInt(failedLogins) : 0;
    
    // Calculate base risk score
    let riskScore = 0.3; // Base risk
    
    // Increase risk for first-time IP
    if (isFirstLogin) {
      riskScore += 0.3;
    }
    
    // Increase risk for IPs with failed login attempts
    if (failedLoginCount > 0) {
      riskScore += Math.min(failedLoginCount * 0.1, 0.3); // Up to 0.3 additional risk
    }
    
    // In a real system, additional checks would be performed:
    // 1. IP geolocation to check distance from usual location
    // 2. Check against IP blacklists
    // 3. Check for VPN/proxy/TOR exit node
    // 4. Check for IP reputation in security databases
    
    // Ensure risk score is between 0 and 1
    riskScore = Math.max(0, Math.min(1, riskScore));
    
    // Cache the result for 1 hour
    await redis.set(`ip_risk:${ipAddress}`, riskScore.toString(), 3600);
    
    return riskScore;
  } catch (error) {
    logger.error(`Error assessing IP risk for ${ipAddress}:`, error);
    return 0.5; // Medium risk as fallback
  }
}

/**
 * Record failed login attempt from an IP address
 * @param {string} ipAddress - IP address of the failed attempt
 */
async function recordFailedLoginAttempt(ipAddress) {
  try {
    const key = `failed_login:${ipAddress}`;
    const failedLogins = await redis.get(key);
    const failedLoginCount = failedLogins ? parseInt(failedLogins) : 0;
    
    // Increment failed login count and set expiry (24 hours)
    await redis.set(key, (failedLoginCount + 1).toString(), 24 * 60 * 60);
    
    // If too many failed attempts, add to temporary blacklist
    if (failedLoginCount + 1 >= 5) {
      await redis.set(`ip_blacklist:${ipAddress}`, 'true', 30 * 60); // 30 minutes
      logger.warn(`IP ${ipAddress} blacklisted due to multiple failed login attempts`);
    }
  } catch (error) {
    logger.error(`Error recording failed login attempt for IP ${ipAddress}:`, error);
  }
}

/**
 * Check if an IP address is blacklisted
 * @param {string} ipAddress - IP address to check
 * @returns {Promise<boolean>} - Whether the IP is blacklisted
 */
async function isIpBlacklisted(ipAddress) {
  try {
    const blacklisted = await redis.get(`ip_blacklist:${ipAddress}`);
    return blacklisted === 'true';
  } catch (error) {
    logger.error(`Error checking blacklist for IP ${ipAddress}:`, error);
    return false;
  }
}

/**
 * Trust an IP address for a specific user
 * @param {string} ipAddress - IP address to trust
 * @param {string} userId - User ID
 * @param {string} deviceInfo - Device information
 * @returns {Promise<boolean>} - Success status
 */
async function trustIpForUser(ipAddress, userId, deviceInfo) {
  try {
    const user = await User.findById(userId);
    if (!user) return false;
    
    // Create fingerprint from IP and device info
    const fingerprint = `${ipAddress}|${deviceInfo.browser}|${deviceInfo.os}`;
    
    // Check if fingerprint already exists
    const existingIndex = user.deviceFingerprints.findIndex(d => 
      d.fingerprint === fingerprint
    );
    
    if (existingIndex >= 0) {
      // Update existing fingerprint
      user.deviceFingerprints[existingIndex].trusted = true;
      user.deviceFingerprints[existingIndex].lastSeen = new Date();
    } else {
      // Add new fingerprint
      user.deviceFingerprints.push({
        fingerprint,
        device: deviceInfo.device,
        browser: deviceInfo.browser,
        os: deviceInfo.os,
        lastSeen: new Date(),
        trusted: true
      });
    }
    
    await user.save();
    
    // Remove from blacklist if present
    await redis.del(`ip_blacklist:${ipAddress}`);
    
    return true;
  } catch (error) {
    logger.error(`Error trusting IP ${ipAddress} for user ${userId}:`, error);
    return false;
  }
}

module.exports = {
  assessIpRisk,
  recordFailedLoginAttempt,
  isIpBlacklisted,
  trustIpForUser
};