import { Intent, Entity, ConversationContext } from '@/types';
import logger from '@/config/logger';
import axios from 'axios';

interface ChatGPTResponse {
  intent: string;
  confidence: number;
  response: string;
  shouldUseBuiltIn: boolean;
  entities?: any[];
}

export class NLPService {
  private intentPatterns: Map<string, RegExp[]> = new Map();
  private entityPatterns: Map<string, RegExp> = new Map();
  private openaiApiKey: string;

  constructor() {
    this.openaiApiKey = process.env.OPENAI_API_KEY || '';
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // Простые паттерны для быстрого распознавания
    this.intentPatterns.set('GREETING', [
      /\b(привет|здравствуй|добрый\s+день|добрый\s+вечер|добрый\s+утро|салам|сәлем|hello|hi)\b/i,
      /начать|start/i
    ]);

    this.intentPatterns.set('BOOK_APPOINTMENT', [
      /\b(записаться|запись|прием|appointment|записаться\s+на\s+прием|хочу\s+записаться)\b/i,
      /врачу|доктору|стоматологу/i
    ]);

    this.intentPatterns.set('CANCEL_APPOINTMENT', [
      /\b(отменить|отмена|cancel|перенести)\b/i,
      /не\s+смогу\s+прийти/i,
      /отменить\s+запись/i
    ]);

    this.intentPatterns.set('GET_INFO', [
      /\b(информация|info|адрес|телефон|контакты|где\s+находитесь)\b/i,
      /\b(часы\s+работы|график|расписание|когда\s+работаете)\b/i,
      /\b(услуги|цены|стоимость|прайс)\b/i
    ]);

    // Паттерны для извлечения сущностей
    this.entityPatterns.set('PHONE', /(?:\+7|8)[\s\-\(\)]?[\d\s\-\(\)]{10,}/);
    this.entityPatterns.set('DATE', /(\d{1,2})[.\-\/](\d{1,2})[.\-\/]?(\d{2,4})?/);
    this.entityPatterns.set('TIME', /(\d{1,2}):(\d{2})/);
    this.entityPatterns.set('NAME', /меня\s+зовут\s+(\w+)|я\s+(\w+)/i);
  }

  async detectIntent(
    text: string, 
    context: ConversationContext, 
    language: string = 'ru'
  ): Promise<Intent> {
    const normalizedText = this.normalizeText(text);
    const safeContext = this.ensureValidContext(context);
    
    // Если находимся в потоке, используем встроенную логику
    if (safeContext.flow && safeContext.step) {
      return this.analyzeInFlow(normalizedText, safeContext);
    }

    // Если есть API ключ OpenAI, используем ChatGPT
    if (this.openaiApiKey && this.openaiApiKey !== '') {
      try {
        const chatGPTResult = await this.analyzeWithChatGPT(text, safeContext, language);
        
        // ИСПРАВЛЕНО: Всегда возвращаем результат от ChatGPT
        const result: Intent & { chatGPTResponse?: string; shouldUseBuiltIn?: boolean } = {
          name: chatGPTResult.intent,
          confidence: chatGPTResult.confidence,
          entities: chatGPTResult.entities || this.extractEntities(normalizedText),
          context: safeContext,
          chatGPTResponse: chatGPTResult.response,
          shouldUseBuiltIn: chatGPTResult.shouldUseBuiltIn
        };

        // Добавляем логирование для отладки
        logger.info('Returning ChatGPT intent', {
          name: result.name,
          confidence: result.confidence,
          hasChatGPTResponse: !!result.chatGPTResponse,
          shouldUseBuiltIn: result.shouldUseBuiltIn
        });

        return result;
      } catch (error) {
        logger.error('ChatGPT processing failed, falling back to patterns:', error);
      }
    }

    // Проверяем простые паттерны как fallback
    const quickIntent = this.checkQuickPatterns(normalizedText, safeContext);
    if (quickIntent) {
      return quickIntent;
    }

    // Fallback к базовой логике
    return {
      name: 'UNKNOWN',
      confidence: 0.1,
      entities: this.extractEntities(normalizedText),
      context: safeContext
    };
  }

  private checkQuickPatterns(text: string, context: ConversationContext): Intent | null {
    // Быстрая проверка основных команд
    for (const [intentName, patterns] of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return {
            name: intentName,
            confidence: 0.9,
            entities: this.extractEntities(text),
            context
          };
        }
      }
    }
    return null;
  }

  private async analyzeWithChatGPT(
    text: string, 
    context: ConversationContext,
    language: string
  ): Promise<ChatGPTResponse> {
    try {
      const systemPrompt = `Ты - ассистент стоматологической клиники "Белый зуб". 

Твоя задача:
1. Определить намерение пользователя
2. Дать естественный, дружелюбный ответ
3. При необходимости направить на конкретные действия

Доступные намерения:
- GREETING: приветствие, вопросы "как дела"
- BOOK_APPOINTMENT: запись на прием
- CANCEL_APPOINTMENT: отмена записи
- GET_INFO: информация о клинике, услугах, ценах
- CASUAL_CONVERSATION: дружеская беседа, общие вопросы
- CONTINUE_CONVERSATION: продолжение диалога

Услуги клиники:
- Консультация стоматолога - от 5,000 тг
- Профессиональная чистка зубов - 15,000 тг
- Лечение кариеса - от 25,000 тг
- Протезирование - от 50,000 тг
- Имплантация - от 200,000 тг
- Ортодонтия (брекеты) - от 300,000 тг

Контакты:
- Телефон: +7 (701) 234-56-78
- Адрес: г. Алматы, ул. Абая, 123
- Режим работы: Пн-Пт 09:00-18:00, Сб 10:00-16:00, Вс - выходной

Ответь JSON в формате:
{
  "intent": "название_намерения",
  "confidence": 0.9,
  "response": "дружелюбный ответ на русском",
  "shouldUseBuiltIn": true/false,
  "entities": []
}

shouldUseBuiltIn = true ТОЛЬКО если нужно запустить процесс записи или отмены через встроенную логику
shouldUseBuiltIn = false для всех остальных случаев (приветствие, информация, беседа)`;

      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini', // Используем более экономичную модель
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      }, {
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const result = JSON.parse(response.data.choices[0].message.content);
      
      logger.info('ChatGPT analysis result', {
        intent: result.intent,
        confidence: result.confidence,
        shouldUseBuiltIn: result.shouldUseBuiltIn,
        responsePreview: result.response?.substring(0, 50)
      });

      return result;

    } catch (error: any) {
      logger.error('ChatGPT analysis failed:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status
      });
      
      // Fallback к простому анализу
      return {
        intent: 'UNKNOWN',
        confidence: 0.1,
        response: 'Извините, я не совсем понял ваш вопрос. Могу помочь записаться на прием, предоставить информацию о клинике или ответить на вопросы об услугах.',
        shouldUseBuiltIn: false,
        entities: []
      };
    }
  }

  private ensureValidContext(context: ConversationContext | any): ConversationContext {
    if (!context || typeof context !== 'object') {
      logger.warn('Invalid context provided, using default');
      return {
        flow: '',
        step: '',
        data: {},
        retryCount: 0,
        startTime: new Date()
      };
    }

    return {
      flow: context.flow || '',
      step: context.step || '',
      data: context.data || {},
      retryCount: context.retryCount || 0,
      startTime: context.startTime ? new Date(context.startTime) : new Date()
    };
  }

  private analyzeInFlow(text: string, context: ConversationContext): Intent {
    const entities = this.extractEntities(text);
    
    // В потоке считаем, что пользователь отвечает на текущий вопрос
    switch (context.step) {
      case 'COLLECT_NAME':
        return {
          name: 'PROVIDE_NAME',
          confidence: 0.95,
          entities: entities.filter(e => e.type === 'NAME'),
          context
        };
        
      case 'COLLECT_PHONE':
        return {
          name: 'PROVIDE_PHONE',
          confidence: 0.95,
          entities: entities.filter(e => e.type === 'PHONE'),
          context
        };
        
      case 'SELECT_SERVICE':
      case 'SELECT_DOCTOR':
      case 'SELECT_DATE':
      case 'SELECT_TIME':
        return {
          name: 'MAKE_SELECTION',
          confidence: 0.95,
          entities,
          context
        };
        
      case 'CONFIRMATION':
        if (/\b(да|подтверждаю|confirm|yes|хорошо|согласен)\b/i.test(text)) {
          return {
            name: 'CONFIRM_APPOINTMENT',
            confidence: 0.98,
            entities,
            context
          };
        } else if (/\b(нет|отмена|cancel|no|не\s+нужно)\b/i.test(text)) {
          return {
            name: 'CANCEL_FLOW',
            confidence: 0.98,
            entities,
            context
          };
        }
        break;
    }

    // Проверяем на специальные команды даже в потоке
    if (/\b(стоп|отмена|выйти|quit|stop|назад)\b/i.test(text)) {
      return {
        name: 'CANCEL_FLOW',
        confidence: 0.99,
        entities,
        context
      };
    }

    return {
      name: 'CONTINUE_FLOW',
      confidence: 0.8,
      entities,
      context
    };
  }

  private extractEntities(text: string): Entity[] {
    const entities: Entity[] = [];
    
    for (const [type, pattern] of this.entityPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        entities.push({
          type,
          value: matches[0],
          confidence: 0.9,
          start: matches.index || 0,
          end: (matches.index || 0) + matches[0].length
        });
      }
    }

    return entities;
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^\w\s\d\.\-\+\(\)]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Метод для обучения на новых данных (для будущего развития)
  async trainOnConversation(messages: string[], outcomes: string[]): Promise<void> {
    logger.info('Training data received', { messages: messages.length, outcomes: outcomes.length });
  }
}