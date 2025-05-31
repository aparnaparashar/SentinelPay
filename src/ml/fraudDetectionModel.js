const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Model path
const MODEL_DIR = path.join(__dirname, 'models');
const MODEL_PATH = `file://${MODEL_DIR}/fraud_detection_model`;

// Default model for fallback
let model = null;
let isModelLoaded = false;

/**
 * Initialize and load the fraud detection model
 * @returns {Promise<boolean>} - Whether model loading was successful
 */
async function loadModel() {
  try {
    // Check if model directory exists
    if (!fs.existsSync(MODEL_DIR)) {
      fs.mkdirSync(MODEL_DIR, { recursive: true });
      logger.info('Created model directory');
      
      // No model exists yet, we'll create a default one later
      return false;
    }
    
    // Check if model files exist
    const modelJsonPath = path.join(MODEL_DIR, 'fraud_detection_model', 'model.json');
    if (!fs.existsSync(modelJsonPath)) {
      logger.info('No existing model found, will create default model');
      return false;
    }
    
    // Load the model
    model = await tf.loadLayersModel(MODEL_PATH);
    logger.info('Fraud detection model loaded successfully');
    
    isModelLoaded = true;
    return true;
  } catch (error) {
    logger.error('Error loading fraud detection model:', error);
    return false;
  }
}

/**
 * Create a default model when no trained model is available
 * This is a simple model that will be replaced by proper training
 */
async function createDefaultModel() {
  try {
    logger.info('Creating default fraud detection model');
    
    // Create a simple model architecture
    model = tf.sequential();
    
    // Input layer - assuming 23 features (based on extractFeatures function)
    model.add(tf.layers.dense({
      units: 16,
      activation: 'relu',
      inputShape: [23]
    }));
    
    // Hidden layer
    model.add(tf.layers.dense({
      units: 8,
      activation: 'relu'
    }));
    
    // Output layer - binary classification (fraud or not)
    model.add(tf.layers.dense({
      units: 1,
      activation: 'sigmoid'
    }));
    
    // Compile the model
    model.compile({
      optimizer: 'adam',
      loss: 'binaryCrossentropy',
      metrics: ['accuracy']
    });
    
    // Save the default model
    await model.save(MODEL_PATH);
    
    isModelLoaded = true;
    logger.info('Default fraud detection model created and saved');
    
    return true;
  } catch (error) {
    logger.error('Error creating default model:', error);
    return false;
  }
}

/**
 * Use the model to predict fraud risk for a transaction
 * @param {Array} features - Feature vector for the transaction
 * @returns {Promise<number>} - Fraud risk score (0-1)
 */
async function predict(features) {
  try {
    // Make sure model is loaded
    if (!isModelLoaded) {
      const modelLoaded = await loadModel();
      if (!modelLoaded) {
        await createDefaultModel();
      }
    }
    
    // Ensure features array has the right shape
    if (!features || !Array.isArray(features)) {
      throw new Error('Invalid features for prediction');
    }
    
    // If the model expects a different number of features, pad or truncate
    const expectedFeatureCount = model.inputs[0].shape[1];
    
    if (features.length !== expectedFeatureCount) {
      if (features.length < expectedFeatureCount) {
        // Pad with zeros
        features = [...features, ...Array(expectedFeatureCount - features.length).fill(0)];
      } else {
        // Truncate
        features = features.slice(0, expectedFeatureCount);
      }
      
      logger.warn(`Adjusted feature count from ${features.length} to ${expectedFeatureCount}`);
    }
    
    // Convert features to a tensor
    const inputTensor = tf.tensor2d([features]);
    
    // Get prediction
    const prediction = model.predict(inputTensor);
    const score = prediction.dataSync()[0]; // Get the actual value
    
    // Clean up tensors
    inputTensor.dispose();
    prediction.dispose();
    
    return score;
  } catch (error) {
    logger.error('Error during fraud prediction:', error);
    // Return a moderate risk score as fallback
    return 0.5;
  }
}

// Initialize model on module load
(async () => {
  try {
    const modelLoaded = await loadModel();
    if (!modelLoaded) {
      await createDefaultModel();
    }
  } catch (error) {
    logger.error('Error initializing fraud detection model:', error);
  }
})();

module.exports = {
  predict,
  loadModel
};