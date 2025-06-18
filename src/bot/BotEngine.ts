import { 
  IncomingMessage, 
  BotResponse, 
  ChatSession, 
  ConversationContext, 
  Intent,
  Patient,
  Clinic
} from '@/types';
import { DatabaseService } from '@/config/database';
import { RedisService } from '@/config/redis';
import { ConversationManager } from './ConversationManager';
import { NLPService } from './NLPService';
import logger from '@/config/logger';

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
        clinic.settings.languages[0] || 'ru'
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
    // Сначала ищем пациента по номеру телефона или chat_id
    let patient = await this.findPatient(message);
    
    if (!patient) {
      // Создаем нового пациента
      patient = await this.createPatient(message);
    }

    // Ищем активную сессию
    let session = await this.db.queryOne<ChatSession>(`
      SELECT * FROM chat_sessions 
      WHERE patient_id = $1 AND platform = $2 AND is_active = true
      ORDER BY last_activity DESC LIMIT 1
    `, [patient.id, message.platform]);

    if (!session) {
      // Создаем новую сессию
      const clinicId = await this.determineClinic(message);
      
      const result = await this.db.query<ChatSession>(`
        INSERT INTO chat_sessions (patient_id, clinic_id, platform, session_data)
        VALUES ($1, $2, $3, $4)
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
        })
      ]);

      session = result.rows[0];
    }

    return session;
  }

  private async findPatient(message: IncomingMessage): Promise<Patient | null> {
    if (message.phone) {
      return this.db.queryOne<Patient>(
        'SELECT * FROM patients WHERE phone = $1',
        [message.phone]
      );
    }

    if (message.chatId) {
      return this.db.queryOne<Patient>(
        'SELECT * FROM patients WHERE chat_id = $1',
        [message.chatId]
      );
    }

    return null;
  }

  private async createPatient(message: IncomingMessage): Promise<Patient> {
    const result = await this.db.query<Patient>(`
      INSERT INTO patients (phone, chat_id, platform, preferred_language)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [
      message.phone || '',
      message.chatId,
      message.platform,
      'ru' // по умолчанию русский
    ]);

    return result.rows[0];
  }

  private async determineClinic(message: IncomingMessage): Promise<number> {
    // В MVP предполагаем одну клинику
    // В будущем можно определять по контексту сообщения или настройкам бота
    const clinic = await this.db.queryOne<{ id: number }>(`
      SELECT id FROM clinics WHERE is_active = true LIMIT 1
    `);

    if (!clinic) {
      throw new Error('No active clinic found');
    }

    return clinic.id;
  }

  private async getClinic(clinicId: number): Promise<Clinic | null> {
    // Проверяем кеш
    const cacheKey = `clinic:${clinicId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
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
  }

  private async handleIntent(
    intent: Intent, 
    session: ChatSession, 
    message: IncomingMessage,
    clinic: Clinic
  ): Promise<BotResponse> {
    
    logger.info('Handling intent', { 
      intent: intent.name, 
      confidence: intent.confidence,
      sessionId: session.id 
    });

    switch (intent.name) {
      case 'GREETING':
        return this.handleGreeting(session, clinic);
      
      case 'BOOK_APPOINTMENT':
        return this.conversationManager.handleBookingFlow(session, intent, clinic);
      
      case 'CANCEL_APPOINTMENT':
        return this.handleCancellation(session, intent);
      
      case 'CONFIRM_APPOINTMENT':
        return this.handleConfirmation(session, intent);
      
      case 'GET_INFO':
        return this.handleInfoRequest(session, intent, clinic);
      
      case 'CHANGE_LANGUAGE':
        return this.handleLanguageChange(session, intent);
      
      default:
        return this.conversationManager.handleCurrentFlow(session, message.text, clinic);
    }
  }

  private async handleGreeting(session: ChatSession, clinic: Clinic): Promise<BotResponse> {
    const patient = await this.db.queryOne<Patient>(`
      SELECT * FROM patients WHERE id = $1
    `, [session.patientId]);

    const greeting = patient?.name 
      ? `Здравствуйте, ${patient.name}!` 
      : 'Здравствуйте!';

    return {
      type: 'keyboard',
      text: `${greeting} Добро пожаловать в клинику "${clinic.name}". Чем могу помочь?`,
      options: [
        { id: 'book', text: '📅 Записаться на прием', value: 'book_appointment' },
        { id: 'info', text: 'ℹ️ Информация о клинике', value: 'clinic_info' },
        { id: 'services', text: '🦷 Наши услуги', value: 'services_info' },
        { id: 'contact', text: '📞 Контакты', value: 'contact_info' }
      ],
      nextStep: 'MAIN_MENU'
    };
  }

  private async handleCancellation(session: ChatSession, intent: Intent): Promise<BotResponse> {
    // Ищем активные записи пациента
    const appointments = await this.db.query(`
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

    return {
      type: 'list',
      text: 'Выберите запись для отмены:',
      options: appointments.rows.map(apt => ({
        id: apt.id.toString(),
        text: `${this.formatDate(apt.appointment_date)} - ${apt.doctor_name}`,
        value: `cancel_${apt.id}`,
        description: apt.service_type
      }))
    };
  }

  private async handleConfirmation(session: ChatSession, intent: Intent): Promise<BotResponse> {
    // Логика подтверждения записи
    const appointmentId = this.extractAppointmentId(intent);
    
    if (appointmentId) {
      await this.db.query(`
        UPDATE appointments 
        SET confirmed = true, status = 'confirmed'
        WHERE id = $1 AND patient_id = $2
      `, [appointmentId, session.patientId]);

      return {
        type: 'text',
        text: '✅ Ваша запись подтверждена! Ждем вас в назначенное время.'
      };
    }

    return {
      type: 'text',
      text: 'Не удалось найти запись для подтверждения.'
    };
  }

  private async handleInfoRequest(session: ChatSession, intent: Intent, clinic: Clinic): Promise<BotResponse> {
    return {
      type: 'text',
      text: `🏥 Клиника: ${clinic.name}\n` +
            `📍 Адрес: ${clinic.address}\n` +
            `📞 Телефон: ${clinic.phone}\n\n` +
            `Мы работаем для вашего здоровья!`
    };
  }

  private async handleLanguageChange(session: ChatSession, intent: Intent): Promise<BotResponse> {
    // Логика смены языка
    return {
      type: 'keyboard',
      text: 'Выберите язык / Тілді таңдаңыз:',
      options: [
        { id: 'ru', text: '🇷🇺 Русский', value: 'lang_ru' },
        { id: 'kz', text: '🇰🇿 Қазақша', value: 'lang_kz' },
        { id: 'en', text: '🇺🇸 English', value: 'lang_en' }
      ]
    };
  }

  private async updateSession(
    session: ChatSession, 
    intent: Intent, 
    response: BotResponse
  ): Promise<void> {
    const updatedContext = {
      ...session.sessionData,
      lastIntent: intent.name,
      lastResponse: response.type,
      step: response.nextStep || session.sessionData.step
    };

    await this.db.query(`
      UPDATE chat_sessions 
      SET session_data = $1, last_activity = NOW()
      WHERE id = $2
    `, [JSON.stringify(updatedContext), session.id]);
  }

  private async logMessage(sessionId: number, type: string, content: string): Promise<void> {
    await this.db.query(`
      INSERT INTO message_logs (session_id, message_type, content)
      VALUES ($1, $2, $3)
    `, [sessionId, type, content]);
  }

  private async checkRateLimit(chatId: string): Promise<void> {
    const key = `rate_limit:${chatId}`;
    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, 60); // 1 minute window
    }
    
    if (current > 30) { // max 30 messages per minute
      throw new Error('Rate limit exceeded');
    }
  }

  private createErrorResponse(message: string): BotResponse {
    return {
      type: 'text',
      text: `❌ ${message}`
    };
  }

  private extractAppointmentId(intent: Intent): number | null {
    // Извлекаем ID записи из сущностей intent
    const idEntity = intent.entities.find(e => e.type === 'appointment_id');
    return idEntity ? parseInt(idEntity.value) : null;
  }

  private formatDate(date: Date): string {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(date));
  }
}