const express = require('express');
const fraudController = require('../controllers/fraudController');
const authMiddleware = require('../middlewares/authMiddleware');
const router = express.Router();

/**
 * @swagger
 * /fraud/cases:
 *   get:
 *     summary: Get fraud cases (Admin only)
 *     tags: [Fraud]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [open, investigating, resolved-genuine, resolved-fraud, closed]
 *         description: Filter by status
 *       - in: query
 *         name: minScore
 *         schema:
 *           type: number
 *         description: Minimum fraud score
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of cases
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *     responses:
 *       200:
 *         description: List of fraud cases
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get(
  '/cases',
  authMiddleware.protect,
  authMiddleware.restrictTo('admin', 'manager'),
  fraudController.getFraudCases
);

/**
 * @swagger
 * /fraud/cases/{id}:
 *   get:
 *     summary: Get a fraud case by ID (Admin only)
 *     tags: [Fraud]
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
 *         description: Fraud case details
 *       404:
 *         description: Case not found
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get(
  '/cases/:id',
  authMiddleware.protect,
  authMiddleware.restrictTo('admin', 'manager'),
  fraudController.getFraudCase
);

/**
 * @swagger
 * /fraud/cases/{id}:
 *   patch:
 *     summary: Update a fraud case (Admin only)
 *     tags: [Fraud]
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
 *               status:
 *                 type: string
 *                 enum: [open, investigating, resolved-genuine, resolved-fraud, closed]
 *               assignedTo:
 *                 type: string
 *               resolutionNotes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Fraud case updated successfully
 *       404:
 *         description: Case not found
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.patch(
  '/cases/:id',
  authMiddleware.protect,
  authMiddleware.restrictTo('admin', 'manager'),
  fraudController.updateFraudCase
);

/**
 * @swagger
 * /fraud/cases/{id}/action:
 *   post:
 *     summary: Add an action to a fraud case (Admin only)
 *     tags: [Fraud]
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
 *               - actionType
 *             properties:
 *               actionType:
 *                 type: string
 *                 enum: [account-freeze, transaction-reversal, customer-contact, security-reset, other]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Action added successfully
 *       404:
 *         description: Case not found
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.post(
  '/cases/:id/action',
  authMiddleware.protect,
  authMiddleware.restrictTo('admin', 'manager'),
  fraudController.addFraudCaseAction
);

/**
 * @swagger
 * /fraud/user-report:
 *   post:
 *     summary: User-reported fraud
 *     tags: [Fraud]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transactionId
 *               - description
 *             properties:
 *               transactionId:
 *                 type: string
 *               description:
 *                 type: string
 *               additionalDetails:
 *                 type: string
 *     responses:
 *       201:
 *         description: Fraud report created successfully
 *       400:
 *         description: Invalid request data
 *       404:
 *         description: Transaction not found
 */
router.post(
  '/user-report',
  authMiddleware.protect,
  fraudController.reportFraud
);

/**
 * @swagger
 * /fraud/summary:
 *   get:
 *     summary: Get fraud statistics summary (Admin only)
 *     tags: [Fraud]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Fraud statistics
 *       403:
 *         description: Forbidden - insufficient permissions
 */
router.get(
  '/summary',
  authMiddleware.protect,
  authMiddleware.restrictTo('admin', 'manager'),
  fraudController.getFraudSummary
);

module.exports = router;