import { Intent, Entity, ConversationContext } from '@/types';
import logger from '@/config/logger';

export class NLPService {
  private intentPatterns: Map<string, RegExp[]> = new Map();
  private entityPatterns: Map<string, RegExp> = new Map();

  constructor() {
    this.initializePatterns();
  }

  private initializePatterns(): void {
    // Паттерны для определения намерений (простая реализация для MVP)
    this.intentPatterns.set('GREETING', [
      /\b(привет|здравствуй|добрый\s+день|добрый\s+вечер|добрый\s+утро|салам|сәлем)\b/i,
      /^(hi|hello|hey)$/i,
      /начать|start/i
    ]);

    this.intentPatterns.set('BOOK_APPOINTMENT', [
      /\b(записаться|запись|прием|appointment|записаться\s+на\s+прием|хочу\s+записаться)\b/i,
      /\b(book|schedule)\b/i,
      /врачу|доктору|стоматологу/i
    ]);

    this.intentPatterns.set('CANCEL_APPOINTMENT', [
      /\b(отменить|отмена|cancel|перенести)\b/i,
      /не\s+смогу\s+прийти/i,
      /отменить\s+запись/i
    ]);

    this.intentPatterns.set('CONFIRM_APPOINTMENT', [
      /\b(да|подтверждаю|подтвердить|confirm|yes)\b/i,
      /приду|буду/i,
      /все\s+верно/i
    ]);

    this.intentPatterns.set('GET_INFO', [
      /\b(информация|info|адрес|телефон|контакты|где\s+находитесь)\b/i,
      /\b(часы\s+работы|график|расписание|когда\s+работаете)\b/i,
      /\b(услуги|цены|стоимость|прайс)\b/i
    ]);

    this.intentPatterns.set('CHANGE_LANGUAGE', [
      /\b(язык|language|тіл|қазақша|русский|english)\b/i,
      /сменить\s+язык/i
    ]);

    this.intentPatterns.set('HELP', [
      /\b(помощь|help|что\s+умеешь|команды)\b/i,
      /не\s+понимаю/i
    ]);

    // Паттерны для извлечения сущностей
    this.entityPatterns.set('PHONE', /(?:\+7|8)[\s\-\(\)]?[\d\s\-\(\)]{10,}/);
    this.entityPatterns.set('DATE', /(\d{1,2})[.\-\/](\d{1,2})[.\-\/]?(\d{2,4})?/);
    this.entityPatterns.set('TIME', /(\d{1,2}):(\d{2})/);
    this.entityPatterns.set('NAME', /меня\s+зовут\s+(\w+)|я\s+(\w+)/i);
    this.entityPatterns.set('APPOINTMENT_ID', /номер\s+(\d+)|запись\s+(\d+)/i);
  }

  async detectIntent(
    text: string, 
    context: ConversationContext, 
    language: string = 'ru'
  ): Promise<Intent> {
    const normalizedText = this.normalizeText(text);
    
    // ИСПРАВЛЕНО: Проверяем что context существует и имеет нужные поля
    const safeContext = this.ensureValidContext(context);
    
    // Если находимся в потоке, анализируем контекст
    if (safeContext.flow && safeContext.step) {
      return this.analyzeInFlow(normalizedText, safeContext);
    }

    // Определяем намерение по паттернам
    for (const [intentName, patterns] of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(normalizedText)) {
          const entities = this.extractEntities(normalizedText);
          
          return {
            name: intentName,
            confidence: 0.9, // Высокая уверенность для точных совпадений
            entities,
            context: safeContext
          };
        }
      }
    }

    // Если ничего не найдено, возвращаем UNKNOWN
    return {
      name: 'UNKNOWN',
      confidence: 0.1,
      entities: this.extractEntities(normalizedText),
      context: safeContext
    };
  }

  // ДОБАВЛЕНО: Метод для обеспечения валидного контекста
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
        if (/\b(да|подтверждаю|confirm|yes)\b/i.test(text)) {
          return {
            name: 'CONFIRM_APPOINTMENT',
            confidence: 0.98,
            entities,
            context
          };
        } else if (/\b(нет|отмена|cancel|no)\b/i.test(text)) {
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
    if (/\b(стоп|отмена|выйти|quit|stop)\b/i.test(text)) {
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
    // Здесь можно добавить логику ML обучения
    logger.info('Training data received', { messages: messages.length, outcomes: outcomes.length });
  }
}