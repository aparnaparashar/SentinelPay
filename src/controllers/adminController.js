import User from '../models/User.js';
import Transaction from '../models/Transaction.js';

export const getSystemStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalTransactions = await Transaction.countDocuments();
    const flaggedTransactions = await Transaction.countDocuments({ status: 'flagged' });
    
    const totalBalance = await User.aggregate([
      { $group: { _id: null, total: { $sum: '$walletBalance' } } }
    ]);

    const recentTransactions = await Transaction.find()
      .sort({ timestamp: -1 })
      .limit(5)
      .populate('userId', 'name email');

    res.json({
      totalUsers,
      totalTransactions,
      flaggedTransactions,
      totalBalance: totalBalance[0]?.total || 0,
      recentTransactions
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
};

export const getFlaggedTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const transactions = await Transaction.find({ status: 'flagged' })
      .sort({ timestamp: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('userId', 'name email')
      .populate('recipient', 'name email')
      .exec();

    const count = await Transaction.countDocuments({ status: 'flagged' });

    res.json({
      transactions,
      totalPages: Math.ceil(count / limit),
      currentPage: page
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching flagged transactions', error: error.message });
  }
};

export const getTopUsers = async (req, res) => {
  try {
    const topByBalance = await User.find()
      .sort({ walletBalance: -1 })
      .limit(10)
      .select('name email walletBalance');

    const topByTransactions = await Transaction.aggregate([
      { $group: { 
        _id: '$userId',
        totalTransactions: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }},
      { $sort: { totalTransactions: -1 }},
      { $limit: 10 }
    ]);

    await User.populate(topByTransactions, { path: '_id', select: 'name email' });

    res.json({
      topByBalance,
      topByTransactions
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching top users', error: error.message });
  }
};

export const updateTransactionStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { status } = req.body;

    const transaction = await Transaction.findByIdAndUpdate(
      transactionId,
      { status },
      { new: true }
    ).populate('userId', 'name email');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    res.json(transaction);
  } catch (error) {
    res.status(500).json({ message: 'Error updating transaction', error: error.message });
  }
};