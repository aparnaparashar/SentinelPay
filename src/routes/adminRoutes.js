import express from 'express';
import { 
  getSystemStats, 
  getFlaggedTransactions, 
  getTopUsers,
  updateTransactionStatus 
} from '../controllers/adminController.js';
import { authenticate, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);
router.use(requireAdmin);

router.get('/stats', getSystemStats);
router.get('/flagged', getFlaggedTransactions);
router.get('/top-users', getTopUsers);
router.patch('/transactions/:transactionId/status', updateTransactionStatus);

export default router;