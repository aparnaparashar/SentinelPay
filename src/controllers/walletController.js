import mongoose from 'mongoose';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import { detectFraud } from '../utils/fraudDetection.js';

export const getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    res.json({ balance: user.walletBalance });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching balance', error: error.message });
  }
};

export const deposit = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, description } = req.body;
    
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const user = await User.findById(req.user.userId).session(session);
    user.walletBalance += amount;
    await user.save();

    const transaction = new Transaction({
      userId: user._id,
      type: 'deposit',
      amount,
      description
    });

    const fraudScore = await detectFraud(transaction);
    transaction.fraudScore = fraudScore;
    
    if (fraudScore > 0.7) {
      transaction.status = 'flagged';
    }

    await transaction.save({ session });
    await session.commitTransaction();

    res.json({ 
      message: 'Deposit successful',
      balance: user.walletBalance,
      transaction
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const withdraw = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, description } = req.body;
    
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const user = await User.findById(req.user.userId).session(session);
    
    if (user.walletBalance < amount) {
      throw new Error('Insufficient funds');
    }

    user.walletBalance -= amount;
    await user.save();

    const transaction = new Transaction({
      userId: user._id,
      type: 'withdraw',
      amount,
      description
    });

    const fraudScore = await detectFraud(transaction);
    transaction.fraudScore = fraudScore;
    
    if (fraudScore > 0.7) {
      transaction.status = 'flagged';
    }

    await transaction.save({ session });
    await session.commitTransaction();

    res.json({ 
      message: 'Withdrawal successful',
      balance: user.walletBalance,
      transaction
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const transfer = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, recipientId, description } = req.body;
    
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    const sender = await User.findById(req.user.userId).session(session);
    const recipient = await User.findById(recipientId).session(session);

    if (!recipient) {
      throw new Error('Recipient not found');
    }

    if (sender.walletBalance < amount) {
      throw new Error('Insufficient funds');
    }

    sender.walletBalance -= amount;
    recipient.walletBalance += amount;

    await sender.save();
    await recipient.save();

    const transaction = new Transaction({
      userId: sender._id,
      type: 'transfer',
      amount,
      recipient: recipient._id,
      description
    });

    const fraudScore = await detectFraud(transaction);
    transaction.fraudScore = fraudScore;
    
    if (fraudScore > 0.7) {
      transaction.status = 'flagged';
    }

    await transaction.save({ session });
    await session.commitTransaction();

    res.json({ 
      message: 'Transfer successful',
      balance: sender.walletBalance,
      transaction
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
};

export const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 10, type } = req.query;
    const query = { userId: req.user.userId };
    
    if (type) {
      query.type = type;
    }

    const transactions = await Transaction.find(query)
      .sort({ timestamp: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const count = await Transaction.countDocuments(query);

    res.json({
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching transactions', error: error.message });
  }
};