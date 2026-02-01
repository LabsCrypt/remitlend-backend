import { Router } from 'express';
import { getRemittanceHistory, simulatePayment } from '../controllers/simulationController.js';

const router = Router();

router.get('/history/:userId', getRemittanceHistory);
router.post('/simulate', simulatePayment);

export default router;
