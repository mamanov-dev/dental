import { Router, Request, Response } from 'express';
import { WhatsAppService } from '@/integrations/WhatsAppService';
import { TelegramService } from '@/integrations/TelegramService';
import { TwilioWhatsAppService } from '@/integrations/TwilioWhatsAppService';
import logger from '@/config/logger';

const router = Router();

// Инициализируем сервисы только если токены настроены
let whatsappService: WhatsAppService | null = null;
let telegramService: TelegramService | null = null;
let twilioWhatsAppService: TwilioWhatsAppService | null = null;

// Безопасная инициализация WhatsApp сервиса (Meta Business API)
try {
  if (process.env.WHATSAPP_ACCESS_TOKEN && 
      process.env.WHATSAPP_PHONE_NUMBER_ID && 
      process.env.WHATSAPP_ACCESS_TOKEN !== 'your-whatsapp-access-token' &&
      process.env.WHATSAPP_ACCESS_TOKEN.startsWith('EAA')) { // Meta токены начинаются с EAA
    whatsappService = new WhatsAppService();
    logger.info('Meta WhatsApp service initialized');
  } else {
    logger.info('Meta WhatsApp service not initialized - tokens not configured or using Twilio');
  }
} catch (error) {
  logger.warn('Meta WhatsApp service initialization failed:', error);
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

// Безопасная инициализация Twilio WhatsApp сервиса
try {
  if (process.env.TWILIO_ACCOUNT_SID && 
      process.env.TWILIO_AUTH_TOKEN && 
      process.env.TWILIO_WHATSAPP_NUMBER) {
    twilioWhatsAppService = new TwilioWhatsAppService();
    logger.info('Twilio WhatsApp service initialized');
  } else {
    logger.info('Twilio WhatsApp service not initialized - credentials not configured');
  }
} catch (error) {
  logger.warn('Twilio WhatsApp service initialization failed:', error);
}

// Meta WhatsApp webhook verification (GET)
router.get('/whatsapp', (req: Request, res: Response): void => {
  logger.info('Meta WhatsApp webhook verification attempt', {
    mode: req.query['hub.mode'],
    hasService: !!whatsappService
  });

  if (!whatsappService) {
    res.status(503).json({ 
      error: 'Meta WhatsApp service not configured',
      message: 'Please set WHATSAPP_ACCESS_TOKEN (EAA...) and WHATSAPP_PHONE_NUMBER_ID for Meta Business API' 
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
    logger.info('Meta WhatsApp webhook verification successful');
    res.status(200).send(result);
  } else {
    logger.warn('Meta WhatsApp webhook verification failed');
    res.status(403).send('Forbidden');
  }
});

// Meta WhatsApp webhook handler (POST)
router.post('/whatsapp', async (req: Request, res: Response): Promise<void> => {
  logger.info('Meta WhatsApp webhook received', {
    hasService: !!whatsappService,
    bodyKeys: Object.keys(req.body || {})
  });

  if (!whatsappService) {
    res.status(503).json({ 
      error: 'Meta WhatsApp service not configured',
      message: 'Please set WHATSAPP_ACCESS_TOKEN (EAA...) and WHATSAPP_PHONE_NUMBER_ID for Meta Business API' 
    });
    return;
  }

  try {
    await whatsappService.handleWebhook(req.body);
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Meta WhatsApp webhook error:', error);
    res.status(200).send('Error processed'); // Возвращаем 200 чтобы Meta не повторял
  }
});

// Twilio WhatsApp webhook handler (POST)
router.post('/whatsapp/twilio', async (req: Request, res: Response): Promise<void> => {
  logger.info('Twilio WhatsApp webhook received', {
    hasService: !!twilioWhatsAppService,
    from: req.body.From,
    body: req.body.Body,
    messageSid: req.body.MessageSid
  });

  if (!twilioWhatsAppService) {
    logger.error('Twilio WhatsApp service not configured');
    res.status(503).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Twilio WhatsApp service not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER</Message>
</Response>`);
    return;
  }

  try {
    await twilioWhatsAppService.handleWebhook(req.body);
    // Twilio ожидает TwiML ответ или пустой 200
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  } catch (error) {
    logger.error('Twilio WhatsApp webhook error:', error);
    // Возвращаем пустой TwiML чтобы Twilio не повторял запрос
    res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
});

// Telegram webhook (если используется webhook вместо polling)
router.post('/telegram', async (req: Request, res: Response): Promise<void> => {
  logger.info('Telegram webhook received', {
    hasService: !!telegramService,
    bodyKeys: Object.keys(req.body || {})
  });

  if (!telegramService) {
    res.status(503).json({ 
      error: 'Telegram service not configured',
      message: 'Please set TELEGRAM_BOT_TOKEN' 
    });
    return;
  }

  try {
    // TODO: Добавить обработку Telegram webhook (пока используется polling)
    logger.info('Telegram webhook received but using polling mode');
    res.status(200).send('OK');
  } catch (error) {
    logger.error('Telegram webhook error:', error);
    res.status(500).send('Error');
  }
});

// Health check для всех webhook'ов
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const health = {
      metaWhatsApp: {
        configured: !!whatsappService,
        healthy: whatsappService ? await whatsappService.healthCheck() : false
      },
      twilioWhatsApp: {
        configured: !!twilioWhatsAppService,
        healthy: twilioWhatsAppService ? await twilioWhatsAppService.healthCheck() : false
      },
      telegram: {
        configured: !!telegramService,
        healthy: telegramService ? await telegramService.healthCheck() : false
      },
      timestamp: new Date().toISOString()
    };

    logger.info('Webhook health check completed', health);
    res.json(health);
  } catch (error) {
    logger.error('Webhook health check error:', error);
    res.status(500).json({
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Status endpoint с подробной информацией
router.get('/status', (req: Request, res: Response): void => {
  try {
    const status = {
      success: true,
      data: {
        metaWhatsApp: {
          enabled: !!whatsappService,
          hasAccessToken: !!(process.env.WHATSAPP_ACCESS_TOKEN && 
                           process.env.WHATSAPP_ACCESS_TOKEN !== 'your-whatsapp-access-token' &&
                           process.env.WHATSAPP_ACCESS_TOKEN.startsWith('EAA')),
          hasPhoneNumberId: !!(process.env.WHATSAPP_PHONE_NUMBER_ID && 
                             process.env.WHATSAPP_PHONE_NUMBER_ID !== 'your-phone-number-id'),
          hasVerifyToken: !!process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        },
        twilioWhatsApp: {
          enabled: !!twilioWhatsAppService,
          hasAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
          hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
          hasWhatsAppNumber: !!process.env.TWILIO_WHATSAPP_NUMBER
        },
        telegram: {
          enabled: !!telegramService,
          hasToken: !!(process.env.TELEGRAM_BOT_TOKEN && 
                     process.env.TELEGRAM_BOT_TOKEN !== 'your-telegram-bot-token')
        },
        activeServices: {
          total: [whatsappService, twilioWhatsAppService, telegramService].filter(Boolean).length,
          list: [
            whatsappService ? 'Meta WhatsApp' : null,
            twilioWhatsAppService ? 'Twilio WhatsApp' : null,
            telegramService ? 'Telegram' : null
          ].filter(Boolean)
        },
        message: 'Webhook service running'
      },
      timestamp: new Date().toISOString()
    };

    res.json(status);
  } catch (error) {
    logger.error('Webhook status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get status',
      timestamp: new Date().toISOString()
    });
  }
});

// Endpoint для тестирования Twilio отправки (только для разработки)
if (process.env.NODE_ENV === 'development') {
  router.post('/whatsapp/twilio/test', async (req: Request, res: Response): Promise<void> => {
    if (!twilioWhatsAppService) {
      res.status(503).json({ 
        error: 'Twilio WhatsApp service not configured'
      });
      return;
    }

    try {
      const { to, message } = req.body;
      
      if (!to || !message) {
        res.status(400).json({
          error: 'Missing required fields: to, message'
        });
        return;
      }

      await twilioWhatsAppService.sendResponse(to, {
        type: 'text',
        text: message
      });

      res.json({
        success: true,
        message: 'Test message sent via Twilio',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to send Twilio test message:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send test message',
        timestamp: new Date().toISOString()
      });
    }
  });
}

// Информационный endpoint
router.get('/info', (req: Request, res: Response): void => {
  res.json({
    endpoints: {
      'GET /webhook/whatsapp': 'Meta WhatsApp webhook verification',
      'POST /webhook/whatsapp': 'Meta WhatsApp webhook handler',
      'POST /webhook/whatsapp/twilio': 'Twilio WhatsApp webhook handler',
      'POST /webhook/telegram': 'Telegram webhook handler',
      'GET /webhook/health': 'Health check for all services',
      'GET /webhook/status': 'Status information',
      'GET /webhook/info': 'This endpoint information'
    },
    services: {
      metaWhatsApp: !!whatsappService,
      twilioWhatsApp: !!twilioWhatsAppService,
      telegram: !!telegramService
    },
    configuration: {
      metaWhatsApp: 'Set WHATSAPP_ACCESS_TOKEN (EAA...) and WHATSAPP_PHONE_NUMBER_ID',
      twilioWhatsApp: 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER',
      telegram: 'Set TELEGRAM_BOT_TOKEN'
    },
    timestamp: new Date().toISOString()
  });
});

export default router;