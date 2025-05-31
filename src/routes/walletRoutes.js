import express from 'express';
import { 
  getBalance, 
  deposit, 
  withdraw, 
  transfer, 
  getTransactions 
} from '../controllers/walletController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authenticate);

router.get('/balance', getBalance);
router.post('/deposit', deposit);
router.post('/withdraw', withdraw);
router.post('/transfer', transfer);
router.get('/transactions', getTransactions);

export default router;