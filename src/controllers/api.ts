import { Router } from 'express';
import appointmentsRouter from './appointments';
import clinicsRouter from './clinics';
import patientsRouter from './patients';
import analyticsRouter from './analytics';
import { authMiddleware } from '@/middleware/auth';

const router = Router();

// Публичные endpoints (без авторизации)
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      service: 'dental-bot-api',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }
  });
});

// Защищенные endpoints
router.use('/appointments', authMiddleware, appointmentsRouter);
router.use('/clinics', authMiddleware, clinicsRouter);
router.use('/patients', authMiddleware, patientsRouter);
router.use('/analytics', authMiddleware, analyticsRouter);

export default router;