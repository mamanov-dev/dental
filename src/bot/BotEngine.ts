import { 
  IncomingMessage, 
  BotResponse, 
  ChatSession, 
  ConversationContext, 
  Intent,
  Patient,
  Clinic,
  ResponseOption
} from '@/types';
import { DatabaseService } from '@/config/database';
import { RedisService } from '@/config/redis';
import { ConversationManager } from './ConversationManager';
import { NLPService } from './NLPService';
import logger from '@/config/logger';

// Расширенный интерфейс для ConversationContext с дополнительными полями
interface ExtendedConversationContext extends ConversationContext {
  lastIntent?: string;
  lastResponse?: string;
  lastMessageTime?: Date;
}

// Интерфейс для записи на прием из БД
interface AppointmentRow {
  id: number;
  appointment_date: Date;
  doctor_name: string;
  service_type?: string;
}

export class BotEngine {
  private db: DatabaseService;
  private redis: RedisService;
  private conversationManager: ConversationManager;
  private nlpService: NLPService;

  constructor() {
    this.db = DatabaseService.getInstance();
    this.redis = RedisService.getInstance();
    this.conversationManager = new ConversationManager();
    this.nlpService = new NLPService();
  }

  async processMessage(message: IncomingMessage): Promise<BotResponse> {
    try {
      logger.info('Processing message', { 
        platform: message.platform, 
        chatId: message.chatId,
        text: message.text?.substring(0, 100)
      });

      // 1. Получаем или создаем сессию
      const session = await this.getOrCreateSession(message);
      
      // 2. Получаем контекст клиники
      const clinic = await this.getClinic(session.clinicId);
      if (!clinic) {
        return this.createErrorResponse('Клиника не найдена');
      }

      // 3. Проверяем rate limiting
      await this.checkRateLimit(message.chatId);

      // 4. Анализируем намерение пользователя
      const intent = await this.nlpService.detectIntent(
        message.text, 
        session.sessionData,
        clinic.settings.languages?.[0] || 'ru'
      );

      // 5. Обрабатываем намерение
      const response = await this.handleIntent(intent, session, message, clinic);

      // 6. Обновляем состояние сессии
      await this.updateSession(session, intent, response);

      // 7. Логируем сообщение
      await this.logMessage(session.id, 'incoming', message.text);
      await this.logMessage(session.id, 'outgoing', response.text);

      return response;

    } catch (error) {
      logger.error('Error processing message:', error);
      return this.createErrorResponse('Произошла ошибка. Попробуйте снова.');
    }
  }

  private async getOrCreateSession(message: IncomingMessage): Promise<ChatSession> {
    try {
      // Сначала ищем пациента по номеру телефона или chat_id
      let patient = await this.findPatient(message);
      
      if (!patient) {
        // Создаем нового пациента
        patient = await this.createPatient(message);
      }

      // Ищем активную сессию
      const existingSession = await this.db.queryOne<ChatSession>(`
        SELECT * FROM chat_sessions 
        WHERE patient_id = $1 AND platform = $2 AND is_active = true
        ORDER BY last_activity DESC LIMIT 1
      `, [patient.id, message.platform]);

      if (existingSession) {
        return existingSession;
      }

      // Создаем новую сессию
      const clinicId = await this.determineClinic(message);
      
      const result = await this.db.query<ChatSession>(`
        INSERT INTO chat_sessions (patient_id, clinic_id, platform, session_data, is_active, last_activity)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
      `, [
        patient.id,
        clinicId,
        message.platform,
        JSON.stringify({
          flow: 'GREETING',
          step: 'START',
          data: {},
          retryCount: 0,
          startTime: new Date()
        }),
        true
      ]);

      if (result.rows.length === 0) {
        throw new Error('Failed to create chat session');
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Error in getOrCreateSession:', error);
      throw error;
    }
  }

  private async findPatient(message: IncomingMessage): Promise<Patient | null> {
    try {
      if (message.phone) {
        return await this.db.queryOne<Patient>(
          'SELECT * FROM patients WHERE phone = $1',
          [message.phone]
        );
      }

      if (message.chatId) {
        return await this.db.queryOne<Patient>(
          'SELECT * FROM patients WHERE chat_id = $1 AND platform = $2',
          [message.chatId, message.platform]
        );
      }

      return null;
    } catch (error) {
      logger.error('Error finding patient:', error);
      return null;
    }
  }

  private async createPatient(message: IncomingMessage): Promise<Patient> {
    try {
      const result = await this.db.query<Patient>(`
        INSERT INTO patients (phone, chat_id, platform, preferred_language, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `, [
        message.phone || null,
        message.chatId,
        message.platform,
        'ru' // по умолчанию русский
      ]);

      return result.rows[0];
    } catch (error) {
      logger.error('Error creating patient:', error);
      throw error;
    }
  }

  private async determineClinic(message: IncomingMessage): Promise<number> {
    try {
      // В MVP предполагаем одну клинику
      // В будущем можно определять по контексту сообщения или настройкам бота
      const clinic = await this.db.queryOne<{ id: number }>(`
        SELECT id FROM clinics WHERE is_active = true LIMIT 1
      `);

      if (!clinic) {
        throw new Error('No active clinic found');
      }

      return clinic.id;
    } catch (error) {
      logger.error('Error determining clinic:', error);
      throw error;
    }
  }

  private async getClinic(clinicId: number): Promise<Clinic | null> {
    try {
      // Проверяем кеш
      const cacheKey = `clinic:${clinicId}`;
      const cached = await this.redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached) as Clinic;
      }

      // Загружаем из БД
      const clinic = await this.db.queryOne<Clinic>(`
        SELECT * FROM clinics WHERE id = $1 AND is_active = true
      `, [clinicId]);

      if (clinic) {
        // Кешируем на 30 минут
        await this.redis.set(cacheKey, JSON.stringify(clinic), 1800);
      }

      return clinic;
    } catch (error) {
      logger.error('Error getting clinic:', error);
      return null;
    }
  }

  private async handleIntent(
    intent: Intent, 
    session: ChatSession, 
    message: IncomingMessage,
    clinic: Clinic
  ): Promise<BotResponse> {
    
    try {
      logger.info('Handling intent', { 
        intent: intent.name, 
        confidence: intent.confidence,
        sessionId: session.id 
      });

      switch (intent.name) {
        case 'GREETING':
          return await this.handleGreeting(session, clinic);
        
        case 'BOOK_APPOINTMENT':
          return await this.conversationManager.handleBookingFlow(session, intent, clinic);
        
        case 'CANCEL_APPOINTMENT':
          return await this.handleCancellation(session, intent);
        
        case 'CONFIRM_APPOINTMENT':
          return await this.handleConfirmation(session, intent);
        
        case 'GET_INFO':
          return await this.handleInfoRequest(session, intent, clinic);
        
        case 'CHANGE_LANGUAGE':
          return await this.handleLanguageChange(session, intent);
        
        case 'FALLBACK':
          return await this.handleFallback(session, message.text);
        
        default:
          return await this.conversationManager.handleCurrentFlow(session, message.text, clinic);
      }
    } catch (error) {
      logger.error('Error handling intent:', error);
      return this.createErrorResponse('Не удалось обработать ваш запрос. Попробуйте еще раз.');
    }
  }

  private async handleGreeting(session: ChatSession, clinic: Clinic): Promise<BotResponse> {
    try {
      const patient = await this.db.queryOne<Patient>(`
        SELECT * FROM patients WHERE id = $1
      `, [session.patientId]);

      const greeting = patient?.name 
        ? `Здравствуйте, ${patient.name}!` 
        : 'Здравствуйте!';

      const options: ResponseOption[] = [
        { id: 'book', text: '📅 Записаться на прием', value: 'book_appointment' },
        { id: 'info', text: 'ℹ️ Информация о клинике', value: 'clinic_info' },
        { id: 'services', text: '🦷 Наши услуги', value: 'services_info' },
        { id: 'contact', text: '📞 Контакты', value: 'contact_info' }
      ];

      return {
        type: 'keyboard',
        text: `${greeting} Добро пожаловать в клинику "${clinic.name}". Чем могу помочь?`,
        options,
        nextStep: 'MAIN_MENU'
      };
    } catch (error) {
      logger.error('Error in handleGreeting:', error);
      return this.createErrorResponse('Ошибка при загрузке главного меню.');
    }
  }

  private async handleCancellation(session: ChatSession, intent: Intent): Promise<BotResponse> {
    try {
      // Ищем активные записи пациента
      const appointments = await this.db.query<AppointmentRow>(`
        SELECT a.*, d.name as doctor_name 
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        WHERE a.patient_id = $1 
        AND a.status IN ('scheduled', 'confirmed')
        AND a.appointment_date > NOW()
        ORDER BY a.appointment_date
      `, [session.patientId]);

      if (appointments.rows.length === 0) {
        return {
          type: 'text',
          text: 'У вас нет активных записей для отмены.'
        };
      }

      const options: ResponseOption[] = appointments.rows.map((apt: AppointmentRow) => ({
        id: apt.id.toString(),
        text: `${this.formatDate(apt.appointment_date)} - ${apt.doctor_name}`,
        value: `cancel_${apt.id}`,
        description: apt.service_type
      }));

      return {
        type: 'list',
        text: 'Выберите запись для отмены:',
        options
      };
    } catch (error) {
      logger.error('Error in handleCancellation:', error);
      return this.createErrorResponse('Ошибка при загрузке списка записей.');
    }
  }

  private async handleConfirmation(session: ChatSession, intent: Intent): Promise<BotResponse> {
    try {
      // Логика подтверждения записи
      const appointmentId = this.extractAppointmentId(intent);
      
      if (appointmentId) {
        const result = await this.db.query(`
          UPDATE appointments 
          SET confirmed = true, status = 'confirmed', updated_at = NOW()
          WHERE id = $1 AND patient_id = $2
          RETURNING *
        `, [appointmentId, session.patientId]);

        if (result.rows.length > 0) {
          return {
            type: 'text',
            text: '✅ Ваша запись подтверждена! Ждем вас в назначенное время.'
          };
        }
      }

      return {
        type: 'text',
        text: 'Не удалось найти запись для подтверждения.'
      };
    } catch (error) {
      logger.error('Error in handleConfirmation:', error);
      return this.createErrorResponse('Ошибка при подтверждении записи.');
    }
  }

  private async handleInfoRequest(session: ChatSession, intent: Intent, clinic: Clinic): Promise<BotResponse> {
    try {
      return {
        type: 'text',
        text: `🏥 Клиника: ${clinic.name}\n` +
              `📍 Адрес: ${clinic.address || 'Не указан'}\n` +
              `📞 Телефон: ${clinic.phone || 'Не указан'}\n\n` +
              `Мы работаем для вашего здоровья!`
      };
    } catch (error) {
      logger.error('Error in handleInfoRequest:', error);
      return this.createErrorResponse('Ошибка при загрузке информации о клинике.');
    }
  }

  private async handleLanguageChange(session: ChatSession, intent: Intent): Promise<BotResponse> {
    try {
      const options: ResponseOption[] = [
        { id: 'ru', text: '🇷🇺 Русский', value: 'lang_ru' },
        { id: 'kz', text: '🇰🇿 Қазақша', value: 'lang_kz' },
        { id: 'en', text: '🇺🇸 English', value: 'lang_en' }
      ];

      return {
        type: 'keyboard',
        text: 'Выберите язык / Тілді таңдаңыз / Choose language:',
        options
      };
    } catch (error) {
      logger.error('Error in handleLanguageChange:', error);
      return this.createErrorResponse('Ошибка при смене языка.');
    }
  }

  private async handleFallback(session: ChatSession, text: string): Promise<BotResponse> {
    try {
      // Увеличиваем счетчик повторов
      const sessionData = session.sessionData;
      sessionData.retryCount = (sessionData.retryCount || 0) + 1;

      if (sessionData.retryCount > 3) {
        // Если слишком много неудачных попыток, переводим в режим человека
        return {
          type: 'text',
          text: '😔 Извините, я не могу понять ваш запрос. Сейчас я переведу вас на нашего администратора.'
        };
      }

      const options: ResponseOption[] = [
        { id: 'book', text: '📅 Записаться на прием', value: 'book_appointment' },
        { id: 'info', text: 'ℹ️ Информация', value: 'clinic_info' },
        { id: 'help', text: '❓ Помощь', value: 'help' }
      ];

      return {
        type: 'keyboard',
        text: 'Извините, я не понял ваш запрос. Выберите один из вариантов:',
        options
      };
    } catch (error) {
      logger.error('Error in handleFallback:', error);
      return this.createErrorResponse('Произошла ошибка.');
    }
  }

  private async updateSession(
    session: ChatSession, 
    intent: Intent, 
    response: BotResponse
  ): Promise<void> {
    try {
      const updatedContext: ExtendedConversationContext = {
        ...session.sessionData,
        lastIntent: intent.name,
        lastResponse: response.type,
        step: response.nextStep || session.sessionData.step,
        data: {
          ...session.sessionData.data,
          lastMessageTime: new Date()
        }
      };

      await this.db.query(`
        UPDATE chat_sessions 
        SET session_data = $1, last_activity = NOW()
        WHERE id = $2
      `, [JSON.stringify(updatedContext), session.id]);
    } catch (error) {
      logger.error('Error updating session:', error);
      // Не выбрасываем ошибку, чтобы не прерывать основной поток
    }
  }

  private async logMessage(sessionId: number, type: string, content: string): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO message_logs (session_id, message_type, content, created_at)
        VALUES ($1, $2, $3, NOW())
      `, [sessionId, type, content]);
    } catch (error) {
      logger.error('Error logging message:', error);
      // Не выбрасываем ошибку, чтобы не прерывать основной поток
    }
  }

  private async checkRateLimit(chatId: string): Promise<void> {
    try {
      const key = `rate_limit:${chatId}`;
      const current = await this.redis.incr(key);
      
      if (current === 1) {
        await this.redis.expire(key, 60); // 1 minute window
      }
      
      if (current > 30) { // max 30 messages per minute
        throw new Error('Rate limit exceeded');
      }
    } catch (error) {
      if ((error as Error).message === 'Rate limit exceeded') {
        throw error;
      }
      logger.error('Error in rate limiting:', error);
      // При ошибке Redis не блокируем запрос
    }
  }

  private createErrorResponse(message: string): BotResponse {
    return {
      type: 'text',
      text: `❌ ${message}`,
      metadata: {
        error: true,
        timestamp: new Date().toISOString()
      }
    };
  }

  private extractAppointmentId(intent: Intent): number | null {
    try {
      // Извлекаем ID записи из сущностей intent
      const idEntity = intent.entities?.find(e => e.type === 'appointment_id');
      if (idEntity) {
        const id = parseInt(idEntity.value);
        return isNaN(id) ? null : id;
      }
      return null;
    } catch (error) {
      logger.error('Error extracting appointment ID:', error);
      return null;
    }
  }

  private formatDate(date: Date | string): string {
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return new Intl.DateTimeFormat('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(dateObj);
    } catch (error) {
      logger.error('Error formatting date:', error);
      return 'Дата не указана';
    }
  }

  // Публичные методы для управления сессиями
  public async endSession(sessionId: number): Promise<void> {
    try {
      await this.db.query(`
        UPDATE chat_sessions 
        SET is_active = false, ended_at = NOW()
        WHERE id = $1
      `, [sessionId]);
    } catch (error) {
      logger.error('Error ending session:', error);
    }
  }

  public async getSessionMetrics(sessionId: number): Promise<any> {
    try {
      const metrics = await this.db.queryOne(`
        SELECT 
          COUNT(ml.id) as message_count,
          cs.created_at as session_start,
          cs.last_activity,
          cs.session_data
        FROM chat_sessions cs
        LEFT JOIN message_logs ml ON ml.session_id = cs.id
        WHERE cs.id = $1
        GROUP BY cs.id
      `, [sessionId]);

      return metrics;
    } catch (error) {
      logger.error('Error getting session metrics:', error);
      return null;
    }
  }
}