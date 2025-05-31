const express = require('express');
const accountController = require('../controllers/accountController');
const authMiddleware = require('../middlewares/authMiddleware');
const validationMiddleware = require('../middlewares/validationMiddleware');
const router = express.Router();

/**
 * @swagger
 * /accounts:
 *   post:
 *     summary: Create a new account
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accountType
 *             properties:
 *               accountType:
 *                 type: string
 *                 enum: [checking, savings, investment, credit]
 *               currency:
 *                 type: string
 *                 enum: [USD, EUR, GBP, JPY, CAD]
 *                 default: USD
 *               initialBalance:
 *                 type: number
 *                 description: Initial deposit amount
 *     responses:
 *       201:
 *         description: Account created successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
router.post(
  '/',
  authMiddleware.protect,
  validationMiddleware.validateAccountCreate,
  accountController.createAccount
);

/**
 * @swagger
 * /accounts:
 *   get:
 *     summary: Get user's accounts
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: accountType
 *         schema:
 *           type: string
 *           enum: [checking, savings, investment, credit]
 *         description: Filter by account type
 *     responses:
 *       200:
 *         description: List of accounts
 *       401:
 *         description: Unauthorized
 */
router.get(
  '/',
  authMiddleware.protect,
  accountController.getAccounts
);

/**
 * @swagger
 * /accounts/{id}:
 *   get:
 *     summary: Get an account by ID
 *     tags: [Accounts]
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
 *         description: Account details
 *       404:
 *         description: Account not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not your account
 */
router.get(
  '/:id',
  authMiddleware.protect,
  validationMiddleware.accountIdParam,
  accountController.getAccount
);

/**
 * @swagger
 * /accounts/{id}:
 *   patch:
 *     summary: Update an account
 *     tags: [Accounts]
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
 *             properties:
 *               isActive:
 *                 type: boolean
 *               overdraftProtection:
 *                 type: boolean
 *               overdraftLinkedAccount:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Account not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not your account
 */
router.patch(
  '/:id',
  authMiddleware.protect,
  validationMiddleware.accountIdParam,
  validationMiddleware.validateAccountUpdate,
  accountController.updateAccount
);

/**
 * @swagger
 * /accounts/{id}:
 *   delete:
 *     summary: Close an account
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for closing the account
 *     responses:
 *       200:
 *         description: Account closed successfully
 *       400:
 *         description: Cannot close account with balance or pending transactions
 *       404:
 *         description: Account not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not your account
 */
router.delete(
  '/:id',
  authMiddleware.protect,
  validationMiddleware.accountIdParam,
  accountController.closeAccount
);

/**
 * @swagger
 * /accounts/{id}/balance-history:
 *   get:
 *     summary: Get account balance history
 *     tags: [Accounts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, year]
 *         default: month
 *         description: Time period for history
 *     responses:
 *       200:
 *         description: Account balance history
 *       404:
 *         description: Account not found
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - not your account
 */
router.get(
  '/:id/balance-history',
  authMiddleware.protect,
  validationMiddleware.accountIdParam,
  accountController.getBalanceHistory
);

module.exports = router;