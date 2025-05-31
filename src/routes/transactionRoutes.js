const express = require('express');
const transactionController = require('../controllers/transactionController');
const authMiddleware = require('../middlewares/authMiddleware');
const validationMiddleware = require('../middlewares/validationMiddleware');
const router = express.Router();

/**
 * @swagger
 * /transactions:
 *   post:
 *     summary: Create a new transaction
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - transactionType
 *             properties:
 *               sourceAccountId:
 *                 type: string
 *               destinationAccountId:
 *                 type: string
 *               amount:
 *                 type: number
 *                 description: Transaction amount in cents
 *               transactionType:
 *                 type: string
 *                 enum: [deposit, withdrawal, transfer, payment, refund]
 *               description:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Transaction created successfully
 *       400:
 *         description: Validation error or insufficient funds
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/',
  authMiddleware.protect,
  validationMiddleware.validateTransactionCreate,
  transactionController.createTransaction
);

/**
 * @swagger
 * /transactions:
 *   get:
 *     summary: Get user's transactions
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of transactions
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: accountId
 *         schema:
 *           type: string
 *         description: Filter by account ID
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for filtering
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for filtering
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, completed, failed, reversed]
 *         description: Filter by status
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [deposit, withdrawal, transfer, payment, refund]
 *         description: Filter by transaction type
 *       - in: query
 *         name: minAmount
 *         schema:
 *           type: number
 *         description: Minimum transaction amount
 *       - in: query
 *         name: maxAmount
 *         schema:
 *           type: number
 *         description: Maximum transaction amount
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *         description: Sort field (e.g., amount, createdAt)
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order
 *     responses:
 *       200:
 *         description: List of transactions
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/',
  authMiddleware.protect,
  transactionController.getTransactions
);

/**
 * @swagger
 * /transactions/{id}:
 *   get:
 *     summary: Get a transaction by ID
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction details
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/:id',
  authMiddleware.protect,
  validationMiddleware.transactionIdParam,
  transactionController.getTransaction
);

/**
 * @swagger
 * /transactions/{id}/receipt:
 *   get:
 *     summary: Generate a transaction receipt
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction receipt
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/:id/receipt',
  authMiddleware.protect,
  validationMiddleware.transactionIdParam,
  transactionController.getTransactionReceipt
);

/**
 * @swagger
 * /transactions/{id}/reverse:
 *   post:
 *     summary: Reverse a transaction
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for reversal
 *     responses:
 *       200:
 *         description: Transaction reversed successfully
 *       400:
 *         description: Cannot reverse transaction
 *       404:
 *         description: Transaction not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.post(
  '/:id/reverse',
  authMiddleware.protect,
  validationMiddleware.transactionIdParam,
  transactionController.reverseTransaction
);

/**
 * @swagger
 * /transactions/analyze:
 *   post:
 *     summary: Analyze a potential transaction for fraud risk
 *     tags: [Transactions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionData
 *             properties:
 *               transactionData:
 *                 type: object
 *                 required:
 *                   - amount
 *                   - transactionType
 *                 properties:
 *                   sourceAccountId:
 *                     type: string
 *                   destinationAccountId:
 *                     type: string
 *                   amount:
 *                     type: number
 *                   transactionType:
 *                     type: string
 *                     enum: [deposit, withdrawal, transfer, payment, refund]
 *     responses:
 *       200:
 *         description: Transaction analysis results
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/analyze',
  authMiddleware.protect,
  validationMiddleware.validateMLPredictionRequest,
  transactionController.analyzeTransaction
);

module.exports = router;