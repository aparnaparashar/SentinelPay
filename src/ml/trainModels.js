const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const Transaction = require('../models/transactionModel');
const Account = require('../models/accountModel');
const FraudCase = require('../models/fraudCaseModel');

// Ensure ML model directory exists
const MODEL_DIR = path.join(__dirname, 'models');
if (!fs.existsSync(MODEL_DIR)) {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
}

/**
 * Train fraud detection models using historical transaction data
 * @returns {Promise<Object>} - Training results
 */
async function trainModels() {
  logger.info('Starting ML model training process');

  try {
    // 1. Collect and prepare training data
    const trainingData = await prepareTrainingData();
    
    if (trainingData.features.length === 0) {
      logger.warn('Insufficient data for training ML models');
      return {
        modelAccuracy: 0,
        trained: false,
        message: 'Insufficient training data'
      };
    }
    
    logger.info(`Prepared ${trainingData.features.length} records for training`);
    
    // 2. Create and train the model
    const model = createModel(trainingData.featureCount);
    
    // Convert data to tensors
    const xs = tf.tensor2d(trainingData.features);
    const ys = tf.tensor2d(trainingData.labels);
    
    // Train the model
    const history = await model.fit(xs, ys, {
      epochs: 50,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          logger.debug(`Epoch ${epoch}: loss = ${logs.loss}, accuracy = ${logs.acc}`);
        }
      }
    });
    
    // 3. Save the trained model
    await model.save(`file://${MODEL_DIR}/fraud_detection_model`);
    
    // 4. Evaluate the model
    const evaluation = await model.evaluate(xs, ys);
    const accuracy = evaluation[1].dataSync()[0];
    
    logger.info(`Model training complete with accuracy: ${accuracy}`);
    
    // Clean up tensors
    xs.dispose();
    ys.dispose();
    
    return {
      modelAccuracy: accuracy,
      trained: true,
      epochs: history.epoch.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error during ML model training:', error);
    throw error;
  }
}

/**
 * Create the ML model architecture
 * @param {number} featureCount - Number of input features
 * @returns {tf.Sequential} - TensorFlow.js Sequential model
 */
function createModel(featureCount) {
  const model = tf.sequential();
  
  // Input layer
  model.add(tf.layers.dense({
    units: 64,
    activation: 'relu',
    inputShape: [featureCount]
  }));
  
  // Hidden layers
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
  
  // Output layer - binary classification (fraud or not)
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
  
  // Compile the model
  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'binaryCrossentropy',
    metrics: ['accuracy']
  });
  
  return model;
}

/**
 * Prepare training data from transaction history
 * @returns {Promise<Object>} - Prepared features and labels
 */
async function prepareTrainingData() {
  // Get historical transactions with known fraud status
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  // Get transactions and their fraud status
  const transactions = await Transaction.find({
    createdAt: { $gte: sixMonthsAgo }
  }).sort({ createdAt: -1 }).limit(10000);
  
  // Get fraud cases for labeling
  const fraudCases = await FraudCase.find({
    transactionId: { $in: transactions.map(t => t._id) }
  });
  
  // Map transaction IDs to fraud status
  const fraudMap = {};
  fraudCases.forEach(fraudCase => {
    // Consider resolved-fraud status as confirmed fraud
    const isFraud = fraudCase.status === 'resolved-fraud';
    fraudMap[fraudCase.transactionId.toString()] = isFraud ? 1 : 0;
  });
  
  // Prepare features and labels
  const features = [];
  const labels = [];
  
  for (const transaction of transactions) {
    try {
      // Extract features from transaction
      const featureVector = await extractFeatures(transaction);
      
      // Get label (1 for fraud, 0 for legitimate)
      // If we don't have a fraud case for this transaction, assume it's legitimate (label 0)
      const label = fraudMap[transaction._id.toString()] || 0;
      
      features.push(featureVector);
      labels.push([label]);
    } catch (error) {
      logger.error(`Error extracting features for transaction ${transaction._id}:`, error);
      // Skip this transaction
    }
  }
  
  return {
    features,
    labels,
    featureCount: features.length > 0 ? features[0].length : 0
  };
}

/**
 * Extract features from a transaction for ML model
 * @param {Object} transaction - Transaction object
 * @returns {Promise<Array>} - Feature vector
 */
async function extractFeatures(transaction) {
  // Get account and user information
  const account = transaction.sourceAccountId ? 
    await Account.findById(transaction.sourceAccountId) :
    await Account.findById(transaction.destinationAccountId);
  
  if (!account) {
    throw new Error('Account not found for transaction');
  }
  
  // Extract transaction time features
  const hour = transaction.createdAt.getHours();
  const dayOfWeek = transaction.createdAt.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0;
  const isBusinessHours = (hour >= 9 && hour <= 17) ? 1 : 0;
  
  // Get recent transactions for this account
  const thirtyDaysAgo = new Date(transaction.createdAt);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentTransactions = await Transaction.find({
    $or: [
      { sourceAccountId: account._id },
      { destinationAccountId: account._id }
    ],
    createdAt: { 
      $gte: thirtyDaysAgo, 
      $lt: transaction.createdAt
    }
  }).sort({ createdAt: -1 }).limit(100);
  
  // Calculate transaction statistics
  const transactionCount = recentTransactions.length;
  
  // If there are no recent transactions, this might be suspicious
  if (transactionCount === 0) {
    // Return features for a new account with no history
    return [
      transaction.amount / 10000, // Normalize amount
      transaction.transactionType === 'transfer' ? 1 : 0,
      transaction.transactionType === 'withdrawal' ? 1 : 0,
      transaction.transactionType === 'deposit' ? 1 : 0,
      transaction.transactionType === 'payment' ? 1 : 0,
      0, // No transaction history
      0, // No average amount
      0, // No standard deviation
      1, // New account flag
      hour / 24, // Normalize hour of day
      isWeekend,
      isBusinessHours,
      account.accountType === 'checking' ? 1 : 0,
      account.accountType === 'savings' ? 1 : 0,
      account.accountType === 'investment' ? 1 : 0,
      account.accountType === 'credit' ? 1 : 0,
      1, // High risk due to no history
      account.balance / 100000 // Normalize balance
    ];
  }
  
  // Calculate average amount of recent transactions
  const avgAmount = recentTransactions.reduce((sum, t) => sum + t.amount, 0) / transactionCount;
  
  // Calculate standard deviation of amounts
  const stdDevAmount = calculateStdDev(
    recentTransactions.map(t => t.amount),
    avgAmount
  );
  
  // Check if current transaction amount is unusual
  const amountZScore = (transaction.amount - avgAmount) / (stdDevAmount || 1);
  const isUnusualAmount = Math.abs(amountZScore) > 2 ? 1 : 0;
  
  // Check transaction velocity
  let transactionVelocity = 0;
  if (recentTransactions.length > 0) {
    const timeSpan = (transaction.createdAt - recentTransactions[recentTransactions.length - 1].createdAt) / (1000 * 3600 * 24); // in days
    transactionVelocity = timeSpan > 0 ? recentTransactions.length / timeSpan : 0;
  }
  
  // Count recent transactions by type
  const typeCounts = {
    transfer: 0,
    withdrawal: 0,
    deposit: 0,
    payment: 0
  };
  
  recentTransactions.forEach(t => {
    if (typeCounts[t.transactionType] !== undefined) {
      typeCounts[t.transactionType]++;
    }
  });
  
  // Calculate account age in days
  const accountAgeInDays = (transaction.createdAt - account.createdAt) / (1000 * 3600 * 24);
  const isNewAccount = accountAgeInDays < 30 ? 1 : 0;
  
  // Feature vector
  return [
    transaction.amount / 10000, // Normalize amount
    transaction.transactionType === 'transfer' ? 1 : 0,
    transaction.transactionType === 'withdrawal' ? 1 : 0,
    transaction.transactionType === 'deposit' ? 1 : 0,
    transaction.transactionType === 'payment' ? 1 : 0,
    transactionCount / 100, // Normalize transaction count
    avgAmount / 10000, // Normalize average amount
    stdDevAmount / 10000, // Normalize standard deviation
    isNewAccount,
    hour / 24, // Normalize hour of day
    isWeekend,
    isBusinessHours,
    account.accountType === 'checking' ? 1 : 0,
    account.accountType === 'savings' ? 1 : 0,
    account.accountType === 'investment' ? 1 : 0,
    account.accountType === 'credit' ? 1 : 0,
    isUnusualAmount,
    account.balance / 100000, // Normalize balance
    transactionVelocity / 10, // Normalize transaction velocity
    typeCounts.transfer / 100, // Normalize transfer count
    typeCounts.withdrawal / 100, // Normalize withdrawal count
    typeCounts.deposit / 100, // Normalize deposit count
    typeCounts.payment / 100 // Normalize payment count
  ];
}

/**
 * Calculate standard deviation
 * @param {Array} values - Array of values
 * @param {number} avg - Average value
 * @returns {number} - Standard deviation
 */
function calculateStdDev(values, avg) {
  if (values.length === 0) return 0;
  
  const squareDiffs = values.map(value => {
    const diff = value - avg;
    return diff * diff;
  });
  
  const avgSquareDiff = squareDiffs.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(avgSquareDiff);
}

module.exports = { trainModels };