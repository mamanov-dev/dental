import { Router, Request, Response } from 'express';
import { WhatsAppService } from '@/integrations/WhatsAppService';
import { TelegramService } from '@/integrations/TelegramService';
import logger from '@/config/logger';

const router = Router();

// WhatsApp webhook
const whatsappService = new WhatsAppService();

router.get('/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const result = whatsappService.verifyWebhook(
    mode as string,
    token as string,
    challenge as string
  );

  if (result) {
    res.status(200).send(result);
  } else {
    res.status(403).send('Forbidden');
  }
});

router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    await whatsappService.handleWebhook(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('WhatsApp webhook error:', error);
    res.status(500).send('Error');
  }
});

// Telegram webhook (если используется webhook вместо polling)
router.post('/telegram', async (req: Request, res: Response) => {
  try {
    // Обработка Telegram webhook
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Telegram webhook error:', error);
    res.status(500).send('Error');
  }
});

export default router;