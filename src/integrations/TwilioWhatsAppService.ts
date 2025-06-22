import twilio from 'twilio';
import { IncomingMessage, BotResponse } from '@/types';
import { BotEngine } from '@/bot/BotEngine';
import logger from '@/config/logger';

export class TwilioWhatsAppService {
  private client: twilio.Twilio;
  private botEngine: BotEngine;
  private fromNumber: string;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID!;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    this.fromNumber = process.env.TWILIO_WHATSAPP_NUMBER!;
    
    this.client = twilio(accountSid, authToken);
    this.botEngine = new BotEngine();

    if (!accountSid || !authToken || !this.fromNumber) {
      throw new Error('Twilio credentials not configured');
    }

    logger.info('Twilio WhatsApp service configured', {
      fromNumber: this.fromNumber,
      hasAccountSid: !!accountSid,
      hasAuthToken: !!authToken
    });
  }

  async handleWebhook(body: any): Promise<void> {
    try {
      const message = body.Body;
      const from = body.From; // Уже в формате whatsapp:+77783425825
      const messageId = body.MessageSid;

      logger.info('Processing Twilio WhatsApp message', { 
        message, 
        from,
        messageId
      });

      if (!message || !from) {
        logger.warn('Missing message or from field in webhook');
        return;
      }

      // Извлекаем чистый номер телефона из whatsapp:+77783425825
      const cleanPhone = from.replace('whatsapp:', '');

      const incomingMessage: IncomingMessage = {
        platform: 'whatsapp',
        chatId: cleanPhone,
        text: message,
        phone: cleanPhone,
        messageId,
        timestamp: new Date()
      };

      logger.info('Processing message', {
        platform: incomingMessage.platform,
        chatId: incomingMessage.chatId,
        text: incomingMessage.text?.substring(0, 100)
      });

      const response = await this.botEngine.processMessage(incomingMessage);
      await this.sendResponse(from, response); // Передаем оригинальный from с whatsapp: префиксом
    } catch (error) {
      logger.error('Error processing Twilio webhook:', error);
    }
  }

  async sendResponse(to: string, response: BotResponse): Promise<void> {
    try {
      // Убеждаемся что номера в правильном формате
      let fromNumber = this.fromNumber;
      let toNumber = to;

      // From должен быть whatsapp:+14155238886
      if (!fromNumber.startsWith('whatsapp:')) {
        fromNumber = `whatsapp:${fromNumber}`;
      }

      // To должен быть whatsapp:+77783425825 (уже приходит в правильном формате)
      if (!toNumber.startsWith('whatsapp:')) {
        toNumber = `whatsapp:${toNumber}`;
      }

      // Преобразуем кнопки в текстовое меню для Twilio
      let messageText = response.text;
      
      if (response.type === 'keyboard' || response.type === 'list') {
        if (response.options && response.options.length > 0) {
          messageText += '\n\n📋 Выберите (отправьте номер):';
          response.options.forEach((option, index) => {
            messageText += `\n${index + 1}. ${option.text}`;
          });
          messageText += '\n\nИли напишите ваш выбор текстом.';
        }
      }

      logger.info('Sending Twilio message', {
        from: fromNumber,
        to: toNumber,
        messageLength: messageText?.length,
        hasOptions: !!(response.options && response.options.length > 0)
      });

      await this.client.messages.create({
        from: fromNumber,
        to: toNumber,
        body: messageText
      });

      logger.info('Twilio WhatsApp message sent successfully', { 
        to: toNumber,
        messageLength: messageText?.length
      });
    } catch (error) {
      logger.error('Failed to send Twilio message:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.api.accounts(process.env.TWILIO_ACCOUNT_SID!).fetch();
      return true;
    } catch (error) {
      logger.error('Twilio health check failed:', error);
      return false;
    }
  }
}