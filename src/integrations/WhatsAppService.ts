import axios from 'axios';
import { IncomingMessage, BotResponse, ResponseOption } from '@/types';
import { BotEngine } from '@/bot/BotEngine';
import logger from '@/config/logger';

interface WhatsAppMessage {
  messaging_product: string;
  to: string;
  type: string;
  text?: { body: string };
  interactive?: any;
}

export class WhatsAppService {
  private apiUrl = 'https://graph.facebook.com/v17.0';
  private accessToken: string;
  private phoneNumberId: string;
  private verifyToken: string;
  private botEngine: BotEngine;

  constructor() {
    this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN!;
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID!;
    this.verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN!;
    this.botEngine = new BotEngine();

    if (!this.accessToken || !this.phoneNumberId) {
      throw new Error('WhatsApp credentials not configured');
    }
  }

  // Webhook verification
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === this.verifyToken) {
      logger.info('WhatsApp webhook verified successfully');
      return challenge;
    }
    logger.warn('WhatsApp webhook verification failed');
    return null;
  }

  // Обработка входящих webhooks
  async handleWebhook(body: any): Promise<void> {
    try {
      if (body.object !== 'whatsapp_business_account') {
        return;
      }

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field === 'messages') {
            await this.processMessages(change.value);
          }
        }
      }
    } catch (error) {
      logger.error('Error processing WhatsApp webhook:', error);
    }
  }

  private async processMessages(value: any): Promise<void> {
    const messages = value.messages || [];
    const contacts = value.contacts || [];

    for (const message of messages) {
      if (message.type === 'text') {
        await this.processTextMessage(message, contacts);
      } else if (message.type === 'interactive') {
        await this.processInteractiveMessage(message, contacts);
      }
    }
  }

  private async processTextMessage(message: any, contacts: any[]): Promise<void> {
    const contact = contacts.find(c => c.wa_id === message.from);
    
    const incomingMessage: IncomingMessage = {
      platform: 'whatsapp',
      chatId: message.from,
      text: message.text.body,
      phone: contact?.wa_id ? `+${contact.wa_id}` : undefined,
      messageId: message.id,
      timestamp: new Date(parseInt(message.timestamp) * 1000)
    };

    logger.info('Processing WhatsApp message', {
      from: message.from,
      text: message.text.body.substring(0, 100)
    });

    try {
      const response = await this.botEngine.processMessage(incomingMessage);
      await this.sendResponse(message.from, response);
    } catch (error) {
      logger.error('Error processing message:', error);
      await this.sendErrorMessage(message.from);
    }
  }

  private async processInteractiveMessage(message: any, contacts: any[]): Promise<void> {
    let userInput = '';
    
    if (message.interactive.type === 'button_reply') {
      userInput = message.interactive.button_reply.id;
    } else if (message.interactive.type === 'list_reply') {
      userInput = message.interactive.list_reply.id;
    }

    const contact = contacts.find(c => c.wa_id === message.from);
    
    const incomingMessage: IncomingMessage = {
      platform: 'whatsapp',
      chatId: message.from,
      text: userInput,
      phone: contact?.wa_id ? `+${contact.wa_id}` : undefined,
      messageId: message.id,
      timestamp: new Date(parseInt(message.timestamp) * 1000),
      isButton: true,
      buttonData: userInput
    };

    try {
      const response = await this.botEngine.processMessage(incomingMessage);
      await this.sendResponse(message.from, response);
    } catch (error) {
      logger.error('Error processing interactive message:', error);
      await this.sendErrorMessage(message.from);
    }
  }

  async sendResponse(to: string, response: BotResponse): Promise<void> {
    try {
      switch (response.type) {
        case 'text':
          await this.sendTextMessage(to, response.text);
          break;
          
        case 'keyboard':
          if (response.options && response.options.length <= 3) {
            await this.sendButtonMessage(to, response.text, response.options);
          } else {
            await this.sendListMessage(to, response.text, response.options || []);
          }
          break;
          
        case 'list':
          await this.sendListMessage(to, response.text, response.options || []);
          break;
          
        default:
          await this.sendTextMessage(to, response.text);
      }
    } catch (error) {
      logger.error('Error sending WhatsApp response:', error);
      throw error;
    }
  }

  private async sendTextMessage(to: string, text: string): Promise<void> {
    const message: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    };

    await this.sendMessage(message);
  }

  private async sendButtonMessage(to: string, text: string, options: ResponseOption[]): Promise<void> {
    const buttons = options.slice(0, 3).map(option => ({
      type: 'reply',
      reply: {
        id: option.value,
        title: option.text.substring(0, 20) // WhatsApp limit
      }
    }));

    const message: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: { buttons }
      }
    };

    await this.sendMessage(message);
  }

  private async sendListMessage(to: string, text: string, options: ResponseOption[]): Promise<void> {
    const rows = options.slice(0, 10).map(option => ({
      id: option.value,
      title: option.text.substring(0, 24), // WhatsApp limit
      description: option.description?.substring(0, 72) || ''
    }));

    const message: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: 'Выберите',
          sections: [{
            title: 'Опции',
            rows
          }]
        }
      }
    };

    await this.sendMessage(message);
  }

  private async sendMessage(message: WhatsAppMessage): Promise<void> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;
    
    try {
      const response = await axios.post(url, message, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      logger.info('WhatsApp message sent successfully', {
        messageId: response.data.messages?.[0]?.id,
        to: message.to
      });
    } catch (error) {
      logger.error('Failed to send WhatsApp message:', {
        error: error.response?.data || error.message,
        to: message.to
      });
      throw error;
    }
  }

  private async sendErrorMessage(to: string): Promise<void> {
    await this.sendTextMessage(
      to, 
      '❌ Произошла ошибка. Попробуйте снова или обратитесь в клинику по телефону.'
    );
  }

  // Проверка статуса WhatsApp API
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.apiUrl}/${this.phoneNumberId}`;
      await axios.get(url, {
        headers: { 'Authorization': `Bearer ${this.accessToken}` },
        timeout: 5000
      });
      return true;
    } catch (error) {
      logger.error('WhatsApp health check failed:', error);
      return false;
    }
  }
}