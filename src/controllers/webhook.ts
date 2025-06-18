import { Router, Request, Response } from 'express';
import { WhatsAppService } from '@/integrations/WhatsAppService';
import { TelegramService } from '@/integrations/TelegramService';
import logger from '@/config/logger';

const router = Router();

// Инициализируем сервисы только если токены настроены
let whatsappService: WhatsAppService | null = null;
let telegramService: TelegramService | null = null;

// Безопасная инициализация WhatsApp сервиса
try {
  if (process.env.WHATSAPP_ACCESS_TOKEN && 
      process.env.WHATSAPP_PHONE_NUMBER_ID && 
      process.env.WHATSAPP_ACCESS_TOKEN !== 'your-whatsapp-access-token') {
    whatsappService = new WhatsAppService();
    logger.info('WhatsApp service initialized');
  } else {
    logger.info('WhatsApp service not initialized - tokens not configured');
  }
} catch (error) {
  logger.warn('WhatsApp service initialization failed:', error);
}

// Безопасная инициализация Telegram сервиса
try {
  if (process.env.TELEGRAM_BOT_TOKEN && 
      process.env.TELEGRAM_BOT_TOKEN !== 'your-telegram-bot-token') {
    telegramService = new TelegramService();
    logger.info('Telegram service initialized');
  } else {
    logger.info('Telegram service not initialized - token not configured');
  }
} catch (error) {
  logger.warn('Telegram service initialization failed:', error);
}

// WhatsApp webhook verification
router.get('/whatsapp', (req: Request, res: Response): void => {
  if (!whatsappService) {
    res.status(503).json({ 
      error: 'WhatsApp service not configured',
      message: 'Please set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID' 
    });
    return;
  }

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

// WhatsApp webhook handler
router.post('/whatsapp', async (req: Request, res: Response): Promise<void> => {
  if (!whatsappService) {
    res.status(503).json({ 
      error: 'WhatsApp service not configured',
      message: 'Please set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID' 
    });
    return;
  }

  try {
    await whatsappService.handleWebhook(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('WhatsApp webhook error:', error);
    res.status(500).send('Error');
  }
});

// Telegram webhook (если используется webhook вместо polling)
router.post('/telegram', async (req: Request, res: Response): Promise<void> => {
  if (!telegramService) {
    res.status(503).json({ 
      error: 'Telegram service not configured',
      message: 'Please set TELEGRAM_BOT_TOKEN' 
    });
    return;
  }

  try {
    // Обработка Telegram webhook будет добавлена позже
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Telegram webhook error:', error);
    res.status(500).send('Error');
  }
});

// Health check для webhook'ов
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  const health = {
    whatsapp: {
      configured: !!whatsappService,
      healthy: whatsappService ? await whatsappService.healthCheck() : false
    },
    telegram: {
      configured: !!telegramService,
      healthy: telegramService ? await telegramService.healthCheck() : false
    },
    timestamp: new Date().toISOString()
  };

  res.json(health);
});

// Status endpoint
router.get('/status', (req: Request, res: Response): void => {
  res.json({
    success: true,
    data: {
      whatsapp: !!whatsappService,
      telegram: !!telegramService,
      message: 'Webhook service running'
    },
    timestamp: new Date().toISOString()
  });
});

export default router;