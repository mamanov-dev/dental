import TelegramBot from 'node-telegram-bot-api';
import { IncomingMessage, BotResponse, ResponseOption } from '@/types';
import { BotEngine } from '@/bot/BotEngine';
import logger from '@/config/logger';

export class TelegramService {
  private bot: TelegramBot;
  private botEngine: BotEngine;
  private isPolling: boolean = false;

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token === 'your-telegram-bot-token') {
      throw new Error('Telegram bot token not configured');
    }

    // Создаем бота БЕЗ автоматического polling
    this.bot = new TelegramBot(token, { polling: false });
    this.botEngine = new BotEngine();
    
    // Запускаем polling только если токен реальный
    this.startPolling();
  }

  private async startPolling(): Promise<void> {
    try {
      // Сначала проверяем токен
      await this.bot.getMe();
      
      // Если токен валидный, запускаем polling
      await this.bot.startPolling();
      this.isPolling = true;
      
      this.setupHandlers();
      logger.info('Telegram bot started successfully with polling');
    } catch (error) {
      logger.error('Failed to start Telegram polling:', error);
      // Не выбрасываем ошибку, просто логируем
    }
  }

  private setupHandlers(): void {
    // Обработка текстовых сообщений
    this.bot.on('message', async (msg) => {
      if (msg.text && !msg.text.startsWith('/')) {
        await this.processTextMessage(msg);
      }
    });

    // Обработка callback кнопок
    this.bot.on('callback_query', async (query) => {
      await this.processCallbackQuery(query);
    });

    // Обработка команд
    this.bot.onText(/\/start/, async (msg) => {
      await this.processTextMessage(msg, 'привет');
    });

    this.bot.onText(/\/help/, async (msg) => {
      await this.sendHelpMessage(msg.chat.id);
    });

    // Обработка ошибок
    this.bot.on('error', (error) => {
      logger.error('Telegram bot error:', error);
    });

    // Обработка ошибок polling
    this.bot.on('polling_error', (error) => {
      logger.error('Telegram polling error:', error);
    });
  }

  private async processTextMessage(msg: TelegramBot.Message, customText?: string): Promise<void> {
    const chatId = msg.chat.id;
    const text = customText || msg.text || '';

    const incomingMessage: IncomingMessage = {
      platform: 'telegram',
      chatId: chatId.toString(),
      text,
      messageId: msg.message_id.toString(),
      timestamp: new Date(msg.date * 1000)
    };

    logger.info('Processing Telegram message', {
      chatId,
      text: text.substring(0, 100)
    });

    try {
      const response = await this.botEngine.processMessage(incomingMessage);
      await this.sendResponse(chatId, response);
    } catch (error) {
      logger.error('Error processing Telegram message:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  private async processCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const data = query.data;

    if (!chatId || !data) return;

    // Отвечаем на callback query
    await this.bot.answerCallbackQuery(query.id);

    const incomingMessage: IncomingMessage = {
      platform: 'telegram',
      chatId: chatId.toString(),
      text: data,
      messageId: query.message?.message_id.toString(),
      timestamp: new Date(),
      isButton: true,
      buttonData: data
    };

    try {
      const response = await this.botEngine.processMessage(incomingMessage);
      await this.sendResponse(chatId, response);
    } catch (error) {
      logger.error('Error processing Telegram callback:', error);
      await this.sendErrorMessage(chatId);
    }
  }

  async sendResponse(chatId: number, response: BotResponse): Promise<void> {
    try {
      switch (response.type) {
        case 'text':
          await this.bot.sendMessage(chatId, response.text);
          break;
          
        case 'keyboard':
        case 'list':
          const keyboard = this.createInlineKeyboard(response.options || []);
          await this.bot.sendMessage(chatId, response.text, {
            reply_markup: { inline_keyboard: keyboard }
          });
          break;
          
        default:
          await this.bot.sendMessage(chatId, response.text);
      }
    } catch (error) {
      logger.error('Error sending Telegram response:', error);
      throw error;
    }
  }

  private createInlineKeyboard(options: ResponseOption[]): TelegramBot.InlineKeyboardButton[][] {
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    
    // Группируем кнопки по 2 в ряд
    for (let i = 0; i < options.length; i += 2) {
      const row: TelegramBot.InlineKeyboardButton[] = [];
      
      row.push({
        text: options[i].text,
        callback_data: options[i].value
      });
      
      if (i + 1 < options.length) {
        row.push({
          text: options[i + 1].text,
          callback_data: options[i + 1].value
        });
      }
      
      keyboard.push(row);
    }
    
    return keyboard;
  }

  private async sendHelpMessage(chatId: number): Promise<void> {
    const helpText = `
🤖 Добро пожаловать в стоматологического бота!

Я могу помочь вам:
📅 Записаться на прием
❌ Отменить запись
ℹ️ Получить информацию о клинике
📞 Узнать контакты

Просто напишите, что вас интересует, или выберите из меню.
    `;

    await this.bot.sendMessage(chatId, helpText.trim());
  }

  private async sendErrorMessage(chatId: number): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      '❌ Произошла ошибка. Попробуйте снова или обратитесь в клинику по телефону.'
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      const me = await this.bot.getMe();
      logger.debug('Telegram bot health check passed', { username: me.username });
      return true;
    } catch (error) {
      logger.error('Telegram health check failed:', error);
      return false;
    }
  }

  async stop(): Promise<void> {
    if (this.isPolling) {
      this.bot.stopPolling();
      this.isPolling = false;
    }
    logger.info('Telegram bot stopped');
  }
}