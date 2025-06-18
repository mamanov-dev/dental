import { Router, Request, Response } from 'express';

const router = Router();

// Заглушка для аналитики
router.get('/', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      totalAppointments: 0,
      totalPatients: 0,
      message: 'Analytics endpoint - coming soon'
    },
    timestamp: new Date()
  });
});

export default router;