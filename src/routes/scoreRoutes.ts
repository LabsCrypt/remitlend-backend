import { Router } from 'express';
import { getScore, updateScore } from '../controllers/scoreController.js';
import { validate } from '../middleware/validation.js';
import { getScoreSchema, updateScoreSchema } from '../schemas/scoreSchemas.js';
import { requireApiKey } from '../middleware/auth.js';
import { strictRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

/**
 * @swagger
 * /score/{userId}:
 *   get:
 *     summary: Retrieve a user's credit score
 *     description: >
 *       Returns the current credit score, credit band, and key scoring factors
 *       for the specified user. Used by LoanManager and other contracts to
 *       make lending decisions.
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Score retrieved successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 userId:
 *                   type: string
 *                 score:
 *                   type: integer
 *                   example: 720
 *                 band:
 *                   type: string
 *                   example: Good
 *                 factors:
 *                   type: object
 *       400:
 *         description: Invalid user ID.
 */
router.get('/:userId', validate(getScoreSchema), getScore);

/**
 * @swagger
 * /score/update:
 *   post:
 *     summary: Update a user's credit score based on repayment history
 *     description: >
 *       Adjusts the user's credit score by +15 for on-time repayments or
 *       −30 for late payments. Requires the `x-api-key` header to be set
 *       to the value of the `INTERNAL_API_KEY` environment variable.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - repaymentAmount
 *               - onTime
 *             properties:
 *               userId:
 *                 type: string
 *               repaymentAmount:
 *                 type: number
 *                 example: 500
 *               onTime:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Score updated successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 userId:
 *                   type: string
 *                 repaymentAmount:
 *                   type: number
 *                 onTime:
 *                   type: boolean
 *                 oldScore:
 *                   type: integer
 *                 delta:
 *                   type: integer
 *                 newScore:
 *                   type: integer
 *                 band:
 *                   type: string
 *       400:
 *         description: Validation error.
 *       401:
 *         description: Unauthorised — missing or invalid API key.
 */
router.post('/update', requireApiKey, strictRateLimiter, validate(updateScoreSchema), updateScore);

export default router;
