import { Router, Request, Response } from 'express';

const router = Router();

// Заглушка для пациентов
router.get('/', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
    message: 'Patients endpoint - coming soon',
    timestamp: new Date()
  });
});

export default router;