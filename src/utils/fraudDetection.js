// Simple ML-based fraud detection using a rule-based system with weighted factors
export const detectFraud = async (transaction) => {
  let fraudScore = 0;
  
  // Factor 1: Transaction amount threshold (30% weight)
  const amountScore = calculateAmountScore(transaction.amount);
  fraudScore += amountScore * 0.3;

  // Factor 2: User's transaction frequency (25% weight)
  const frequencyScore = await calculateFrequencyScore(transaction.userId);
  fraudScore += frequencyScore * 0.25;

  // Factor 3: Transaction pattern analysis (25% weight)
  const patternScore = await calculatePatternScore(transaction);
  fraudScore += patternScore * 0.25;

  // Factor 4: Time-based analysis (20% weight)
  const timeScore = calculateTimeScore(transaction.timestamp);
  fraudScore += timeScore * 0.2;

  return Math.min(Math.max(fraudScore, 0), 1); // Ensure score is between 0 and 1
};

const calculateAmountScore = (amount) => {
  // Higher scores for unusually large amounts
  if (amount > 10000) return 1;
  if (amount > 5000) return 0.8;
  if (amount > 1000) return 0.5;
  if (amount > 500) return 0.3;
  return 0.1;
};

const calculateFrequencyScore = async (userId) => {
  const Transaction = (await import('../models/Transaction.js')).default;
  
  // Check transactions in last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentTransactions = await Transaction.countDocuments({
    userId,
    timestamp: { $gte: oneHourAgo }
  });

  if (recentTransactions > 10) return 1;
  if (recentTransactions > 5) return 0.7;
  if (recentTransactions > 3) return 0.4;
  return 0.1;
};

const calculatePatternScore = async (transaction) => {
  const Transaction = (await import('../models/Transaction.js')).default;
  
  // Look for similar transactions in the last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const similarTransactions = await Transaction.find({
    userId: transaction.userId,
    amount: { 
      $gte: transaction.amount * 0.9,
      $lte: transaction.amount * 1.1
    },
    timestamp: { $gte: oneDayAgo }
  });

  if (similarTransactions.length > 5) return 1;
  if (similarTransactions.length > 3) return 0.7;
  if (similarTransactions.length > 1) return 0.4;
  return 0.1;
};

const calculateTimeScore = (timestamp) => {
  const hour = timestamp.getHours();
  
  // Higher risk for transactions during unusual hours
  if (hour >= 1 && hour <= 5) return 0.8; // Very early morning
  if (hour >= 23 || hour === 0) return 0.6; // Late night
  return 0.1; // Normal business hours
};