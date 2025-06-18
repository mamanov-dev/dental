import { Router, Request, Response } from 'express';

const router = Router();

// Заглушка для клиник
router.get('/', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: [],
    message: 'Clinics endpoint - coming soon',
    timestamp: new Date()
  });
});

export default router;