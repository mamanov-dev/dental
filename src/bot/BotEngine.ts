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

  // Метод для создания дефолтного контекста сессии
  private createDefaultSessionData(): ConversationContext {
    return {
      flow: '',
      step: '',
      data: {},
      retryCount: 0,
      startTime: new Date()
    };
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
      logger.info('Session created/found', { sessionId: session.id, clinicId: session.clinicId });
      
      // 2. Получаем контекст клиники
      const clinic = await this.getClinic(session.clinicId);
      if (!clinic) {
        logger.error('Clinic not found', { clinicId: session.clinicId });
        return this.createErrorResponse('Клиника не найдена');
      }
      
      logger.info('Clinic found', { clinicName: clinic.name, clinicId: clinic.id });

      // 3. Проверяем rate limiting
      await this.checkRateLimit(message.chatId);

      // 4. Анализируем намерение пользователя с помощью улучшенного NLP
      const intent = await this.nlpService.detectIntent(
        message.text, 
        session.sessionData,
        clinic.settings?.languages?.[0] || 'ru'
      );

      logger.info('Intent detected', { 
        intent: intent.name, 
        confidence: intent.confidence,
        hasChatGPTResponse: !!(intent as any).chatGPTResponse
      });

      // 5. Обрабатываем намерение
      const response = await this.handleIntent(intent, session, message, clinic);

      // 6. Обновляем состояние сессии
      await this.updateSession(session, intent, response);

      // 7. Логируем сообщение
      await this.logMessage(session.id, 'incoming', message.text);
      await this.logMessage(session.id, 'outgoing', response.text);

      logger.info('Message processed successfully', { responseType: response.type });
      return response;

    } catch (error) {
      logger.error('Error processing message:', error);
      return this.createErrorResponse('Произошла ошибка. Попробуйте снова.');
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

      // Убеждаемся что sessionData существует
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultSessionData();
        logger.warn('Reset session data to default');
      }

      // ИСПРАВЛЕНО: Получаем ChatGPT данные
      const chatGPTResponse = (intent as any).chatGPTResponse;
      const shouldUseBuiltIn = (intent as any).shouldUseBuiltIn;
      
      // 🔥 ДОБАВЛЕНО: Детальное логирование ChatGPT данных
      logger.info('ChatGPT response data:', {
        hasChatGPTResponse: !!chatGPTResponse,
        shouldUseBuiltIn,
        responsePreview: chatGPTResponse?.substring(0, 100),
        intent: intent.name,
        confidence: intent.confidence
      });

      // ИСПРАВЛЕНИЕ: Используем ChatGPT ответ когда shouldUseBuiltIn = false
      if (chatGPTResponse && shouldUseBuiltIn === false) {
        logger.info('🎯 Using ChatGPT response directly', {
          intent: intent.name,
          responseLength: chatGPTResponse.length,
          confidence: intent.confidence
        });
        
        return {
          type: 'text',
          text: chatGPTResponse,
          metadata: {
            source: 'chatgpt',
            intent: intent.name,
            confidence: intent.confidence
          }
        };
      }

      // Проверяем если пользователь в активном потоке и ChatGPT предлагает продолжить встроенную логику
      if (session.sessionData?.flow && session.sessionData?.step && shouldUseBuiltIn !== false) {
        logger.info('User in active flow, using conversation manager');
        return await this.conversationManager.handleCurrentFlow(session, message.text, clinic);
      }

      // Форсируем приветствие для начальных сообщений
      if (intent.name === 'GREETING' || 
          message.text.toLowerCase().includes('привет') ||
          message.text.toLowerCase().includes('hello') ||
          message.text.toLowerCase().includes('start')) {
        intent.name = 'GREETING';
        intent.confidence = 0.95;
        logger.info('Forced greeting intent');
      }

      // Обработка кнопок
      if (message.isButton || message.buttonData) {
        const buttonValue = message.buttonData || message.text;
        logger.info('Processing button click', { buttonValue });
        
        switch (buttonValue) {
          case 'book_appointment':
            intent.name = 'BOOK_APPOINTMENT';
            intent.confidence = 0.99;
            break;
          case 'cancel_appointment':
            intent.name = 'CANCEL_APPOINTMENT';
            intent.confidence = 0.99;
            break;
          case 'clinic_info':
          case 'services_info':
          case 'contact_info':
            intent.name = 'GET_INFO';
            intent.confidence = 0.99;
            break;
        }
        logger.info('Button intent detected', { intent: intent.name });
      }

      // Основная логика обработки намерений
      switch (intent.name) {
        case 'GREETING':
          // ДОБАВЛЕНО: Используем ChatGPT ответ для приветствия если есть
          if (chatGPTResponse && shouldUseBuiltIn === false) {
            logger.info('Using ChatGPT greeting response');
            return {
              type: 'text',
              text: chatGPTResponse,
              metadata: {
                source: 'chatgpt',
                intent: intent.name
              }
            };
          }
          return await this.handleGreeting(session, clinic);
        
        case 'BOOK_APPOINTMENT':
          return await this.conversationManager.handleBookingFlow(session, intent, clinic);
        
        case 'CANCEL_APPOINTMENT':
          return await this.conversationManager.handleCancellationFlow(session, intent, clinic);
        
        case 'CONFIRM_APPOINTMENT':
          return await this.handleConfirmation(session, intent);
        
        case 'GET_INFO':
          // ИСПРАВЛЕНО: Всегда используем ChatGPT ответ если он есть
          if (chatGPTResponse && shouldUseBuiltIn === false) {
            logger.info('Using ChatGPT info response');
            return {
              type: 'text',
              text: chatGPTResponse,
              metadata: {
                source: 'chatgpt',
                intent: intent.name
              }
            };
          }
          return await this.handleInfoRequest(session, intent, clinic, message);
        
        case 'CASUAL_CONVERSATION':
          // НОВОЕ: Обрабатываем дружеское общение через ChatGPT
          if (chatGPTResponse && shouldUseBuiltIn === false) {
            logger.info('Using ChatGPT casual conversation response');
            return {
              type: 'text',
              text: chatGPTResponse,
              metadata: {
                source: 'chatgpt',
                intent: intent.name
              }
            };
          }
          return await this.handleCasualConversation(session, message.text);
        
        case 'CONTINUE_CONVERSATION':
          // ИСПРАВЛЕНО: Всегда используем ChatGPT для продолжения диалога
          if (chatGPTResponse && shouldUseBuiltIn === false) {
            logger.info('Using ChatGPT continue conversation response');
            return {
              type: 'text',
              text: chatGPTResponse,
              metadata: {
                source: 'chatgpt',
                intent: intent.name
              }
            };
          }
          return await this.handleFallback(session, message.text);
        
        case 'FALLBACK':
        case 'UNKNOWN':
        default:
          // ИСПРАВЛЕНО: Используем ChatGPT ответ для неизвестных запросов
          if (chatGPTResponse && shouldUseBuiltIn === false) {
            logger.info('Using ChatGPT fallback response');
            return {
              type: 'text',
              text: chatGPTResponse,
              metadata: {
                source: 'chatgpt',
                intent: intent.name
              }
            };
          }
          
          // Проверяем активный поток
          if (session.sessionData?.flow && session.sessionData?.step) {
            logger.info('User in active flow, processing with ConversationManager');
            return await this.conversationManager.handleCurrentFlow(session, message.text, clinic);
          }
          
          return await this.handleFallback(session, message.text);
      }
    } catch (error) {
      logger.error('Error handling intent:', error);
      return this.createErrorResponse('Не удалось обработать ваш запрос. Попробуйте еще раз.');
    }
  }

  // НОВЫЙ метод для обработки дружеского общения
  private async handleCasualConversation(session: ChatSession, text: string): Promise<BotResponse> {
    try {
      const lowerText = text.toLowerCase();
      
      if (lowerText.includes('как дела') || lowerText.includes('как поживаете')) {
        return {
          type: 'text',
          text: 'Спасибо, что спросили! У нас все отлично - помогаем пациентам обрести красивые улыбки 😊\n\n' +
                'А как у вас дела? Могу ли я помочь вам с записью на прием или ответить на вопросы о наших услугах?'
        };
      }
      
      if (lowerText.includes('спасибо') || lowerText.includes('благодарю')) {
        return {
          type: 'text',
          text: 'Пожалуйста! Всегда рады помочь 😊\n\n' +
                'Если у вас есть еще вопросы или хотите записаться на прием, просто напишите!'
        };
      }
      
      if (lowerText.includes('пока') || lowerText.includes('до свидания')) {
        return {
          type: 'text',
          text: 'До свидания! Берегите свои зубки и обращайтесь, если понадобится помощь 😊\n\n' +
                'Будем рады видеть вас в нашей клинике!'
        };
      }
      
      // Общий дружелюбный ответ
      return {
        type: 'text',
        text: 'Я здесь, чтобы помочь вам! 😊\n\n' +
              'Могу:\n' +
              '• Записать на прием к врачу\n' +
              '• Рассказать о наших услугах и ценах\n' +
              '• Предоставить контакты клиники\n\n' +
              'Просто напишите, что вас интересует!'
      };
    } catch (error) {
      logger.error('Error in handleCasualConversation:', error);
      return this.createErrorResponse('Произошла ошибка в диалоге.');
    }
  }

  private async handleGreeting(session: ChatSession, clinic: Clinic): Promise<BotResponse> {
    try {
      logger.info('Handling greeting', { sessionId: session.id });
      
      const patient = await this.db.queryOne<Patient>(`
        SELECT * FROM patients WHERE id = $1
      `, [session.patientId]);

      const greeting = patient?.name 
        ? `Здравствуйте, ${patient.name}!` 
        : 'Здравствуйте!';

      // Естественное приветствие без меню кнопок
      return {
        type: 'text',
        text: `${greeting} Добро пожаловать в клинику "${clinic.name}"! 🦷\n\n` +
              `Я ваш помощник и могу помочь:\n` +
              `• Записаться на прием к врачу\n` +
              `• Отменить существующую запись\n` +
              `• Рассказать о наших услугах и ценах\n` +
              `• Предоставить контакты и режим работы\n\n` +
              `Просто напишите, что вас интересует, и я с радостью помогу! 😊`,
        nextStep: 'MAIN_MENU'
      };
    } catch (error) {
      logger.error('Error in handleGreeting:', error);
      return this.createErrorResponse('Ошибка при загрузке главного меню.');
    }
  }

  private async handleConfirmation(session: ChatSession, intent: Intent): Promise<BotResponse> {
    try {
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

  private async handleInfoRequest(session: ChatSession, intent: Intent, clinic: Clinic, message: IncomingMessage): Promise<BotResponse> {
    try {
      const buttonValue = message.buttonData || message.text.toLowerCase();
      
      if (buttonValue.includes('услуг') || buttonValue.includes('service')) {
        return {
          type: 'text',
          text: `🦷 Наши услуги:\n\n` +
                `• Консультация стоматолога - от 5,000 тг\n` +
                `• Профессиональная чистка зубов - 15,000 тг\n` +
                `• Лечение кариеса - от 25,000 тг\n` +
                `• Протезирование - от 50,000 тг\n` +
                `• Имплантация - от 200,000 тг\n` +
                `• Ортодонтия (брекеты) - от 300,000 тг\n\n` +
                `Хотите записаться на консультацию? Просто напишите "записаться"!`
        };
      }
      
      if (buttonValue.includes('контакт') || buttonValue.includes('телефон') || buttonValue.includes('адрес')) {
        return {
          type: 'text',
          text: `📞 Контакты:\n\n` +
                `Телефон: ${clinic.phone || '+7 (701) 234-56-78'}\n` +
                `📍 Адрес: ${clinic.address || 'г. Алматы, ул. Абая, 123'}\n\n` +
                `🕐 Режим работы:\n` +
                `Пн-Пт: 09:00 - 18:00\n` +
                `Сб: 10:00 - 16:00\n` +
                `Вс: выходной\n\n` +
                `Мы всегда рады вам помочь! 😊`
        };
      }
      
      // Общая информация о клинике
      return {
        type: 'text',
        text: `🏥 Клиника "${clinic.name}"\n\n` +
              `Мы - современная стоматологическая клиника с опытными врачами и новейшим оборудованием.\n\n` +
              `📍 Адрес: ${clinic.address || 'г. Алматы, ул. Абая, 123'}\n` +
              `📞 Телефон: ${clinic.phone || '+7 (701) 234-56-78'}\n\n` +
              `Спросите меня о наших услугах, ценах или запишитесь на прием! 🦷`
      };
    } catch (error) {
      logger.error('Error in handleInfoRequest:', error);
      return this.createErrorResponse('Ошибка при загрузке информации о клинике.');
    }
  }

  private async handleFallback(session: ChatSession, text: string): Promise<BotResponse> {
    try {
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultSessionData();
      }

      // Проверяем текст на ключевые слова
      const lowerText = text.toLowerCase();
      
      if (lowerText.includes('отмен') || lowerText.includes('cancel')) {
        logger.info('Detected cancellation keywords in fallback');
        const clinic = await this.getClinic(session.clinicId);
        if (clinic) {
          const intent: Intent = { 
            name: 'CANCEL_APPOINTMENT', 
            confidence: 0.95,
            entities: [],
            context: session.sessionData
          };
          return await this.conversationManager.handleCancellationFlow(session, intent, clinic);
        }
      }

      if (lowerText.includes('запис') || lowerText.includes('прием')) {
        logger.info('Detected booking keywords in fallback');
        const clinic = await this.getClinic(session.clinicId);
        if (clinic) {
          const intent: Intent = { 
            name: 'BOOK_APPOINTMENT', 
            confidence: 0.95,
            entities: [],
            context: session.sessionData
          };
          return await this.conversationManager.handleBookingFlow(session, intent, clinic);
        }
      }

      // Дружелюбный fallback ответ
      const sessionData = session.sessionData;
      sessionData.retryCount = (sessionData.retryCount || 0) + 1;

      if (sessionData.retryCount > 3) {
        return {
          type: 'text',
          text: '😔 Извините, мне сложно понять ваш запрос. Давайте я переведу вас на нашего администратора.\n\n' +
                'Или попробуйте написать:\n' +
                '• "записаться" - для записи на прием\n' +
                '• "отменить" - для отмены записи\n' +
                '• "услуги" - узнать о наших услугах\n' +
                '• "контакты" - наши контакты и адрес'
        };
      }

      return {
        type: 'text',
        text: '🤔 Извините, я не совсем понял ваш запрос.\n\n' +
              'Я могу помочь вам:\n' +
              '• Записаться на прием к врачу\n' +
              '• Отменить существующую запись\n' +
              '• Узнать о наших услугах и ценах\n' +
              '• Получить наши контакты\n\n' +
              'Просто напишите, что вас интересует! 😊'
      };
    } catch (error) {
      logger.error('Error in handleFallback:', error);
      return this.createErrorResponse('Произошла ошибка.');
    }
  }

  // Остальные методы остаются без изменений
  private async getOrCreateSession(message: IncomingMessage): Promise<ChatSession> {
    try {
      logger.info('Getting or creating session', { chatId: message.chatId, platform: message.platform });
      
      let patient = await this.findPatient(message);
      
      if (!patient) {
        logger.info('Patient not found, creating new patient');
        patient = await this.createPatient(message);
        logger.info('Patient created', { patientId: patient.id });
      } else {
        logger.info('Patient found', { patientId: patient.id });
      }

      const existingSession = await this.db.queryOne<any>(`
        SELECT * FROM chat_sessions 
        WHERE patient_id = $1 AND platform = $2 AND is_active = true
        ORDER BY last_activity DESC LIMIT 1
      `, [patient.id, message.platform]);

      if (existingSession) {
        logger.info('Found existing session', { 
          sessionId: existingSession.id, 
          clinicId: existingSession.clinic_id 
        });
        
        if (!existingSession.clinic_id) {
          logger.warn('Session missing clinic_id, updating...');
          const defaultClinicId = await this.determineClinic(message);
          
          await this.db.query(`
            UPDATE chat_sessions 
            SET clinic_id = $1 
            WHERE id = $2
          `, [defaultClinicId, existingSession.id]);
          
          existingSession.clinic_id = defaultClinicId;
        }

        let sessionData;
        try {
          if (typeof existingSession.session_data === 'string') {
            sessionData = JSON.parse(existingSession.session_data);
          } else if (existingSession.session_data && typeof existingSession.session_data === 'object') {
            sessionData = existingSession.session_data;
          } else {
            sessionData = this.createDefaultSessionData();
          }
        } catch (error) {
          logger.warn('Failed to parse session_data, using default');
          sessionData = this.createDefaultSessionData();
        }
        
        return {
          id: existingSession.id,
          patientId: existingSession.patient_id,
          clinicId: existingSession.clinic_id,
          platform: existingSession.platform,
          sessionData: sessionData,
          lastActivity: existingSession.last_activity,
          isActive: existingSession.is_active
        };
      }

      const clinicId = await this.determineClinic(message);
      const defaultSessionData = this.createDefaultSessionData();
      
      const result = await this.db.query<any>(`
        INSERT INTO chat_sessions (patient_id, clinic_id, platform, session_data, is_active, last_activity)
        VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING *
      `, [
        patient.id,
        clinicId,
        message.platform,
        JSON.stringify(defaultSessionData),
        true
      ]);

      const newSession = result.rows[0];
      logger.info('New session created', { sessionId: newSession.id });
      
      return {
        id: newSession.id,
        patientId: newSession.patient_id,
        clinicId: newSession.clinic_id,
        platform: newSession.platform,
        sessionData: defaultSessionData,
        lastActivity: newSession.last_activity,
        isActive: newSession.is_active
      };
    } catch (error) {
      logger.error('Error in getOrCreateSession:', error);
      throw error;
    }
  }

  // ИСПРАВЛЕННЫЙ метод findPatient
  private async findPatient(message: IncomingMessage): Promise<Patient | null> {
    try {
      // Нормализуем данные перед поиском
      const normalizedPhone = message.phone ? this.normalizePhoneNumber(message.phone) : null;
      const normalizedChatId = this.normalizeChatId(message.chatId);
      
      logger.info('Finding patient', { 
        phone: normalizedPhone, 
        chatId: normalizedChatId, 
        platform: message.platform 
      });

      // Ищем по обоим критериям одновременно
      const patient = await this.db.queryOne<Patient>(`
        SELECT * FROM patients 
        WHERE (phone = $1 OR (chat_id = $2 AND platform = $3))
        LIMIT 1
      `, [normalizedPhone, normalizedChatId, message.platform]);

      if (patient) {
        logger.info('Patient found', { patientId: patient.id });
        
        // Обновляем недостающие данные если нужно
        const updates: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        if (normalizedPhone && !patient.phone) {
          updates.push(`phone = $${paramIndex}`);
          params.push(normalizedPhone);
          paramIndex++;
        }

        if (normalizedChatId && !patient.chatId) {
          updates.push(`chat_id = $${paramIndex}`);
          params.push(normalizedChatId);
          paramIndex++;
        }

        if (updates.length > 0) {
          updates.push(`updated_at = NOW()`);
          params.push(patient.id);
          
          await this.db.query(`
            UPDATE patients 
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
          `, params);
          
          logger.info('Updated patient with missing data', { patientId: patient.id });
        }
      }

      return patient;
    } catch (error) {
      logger.error('Error finding patient:', error);
      return null;
    }
  }

  // ИСПРАВЛЕННЫЙ метод createPatient
  private async createPatient(message: IncomingMessage): Promise<Patient> {
    try {
      // Нормализуем данные
      const normalizedPhone = message.phone ? this.normalizePhoneNumber(message.phone) : null;
      const normalizedChatId = this.normalizeChatId(message.chatId);
      
      logger.info('Creating patient with normalized data', { 
        phone: normalizedPhone, 
        chatId: normalizedChatId, 
        platform: message.platform 
      });

      // Используем ON CONFLICT для обработки дубликатов
      const result = await this.db.query<Patient>(`
        INSERT INTO patients (phone, chat_id, platform, preferred_language, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (chat_id, platform) 
        WHERE chat_id IS NOT NULL
        DO UPDATE SET
          phone = COALESCE(EXCLUDED.phone, patients.phone),
          updated_at = NOW(),
          last_activity = NOW()
        RETURNING *
      `, [
        normalizedPhone,
        normalizedChatId,
        message.platform,
        'ru'
      ]);

      if (result.rows.length > 0) {
        logger.info('Patient created/updated successfully', { 
          patientId: result.rows[0].id,
          wasUpdate: result.command === 'UPDATE'
        });
        return result.rows[0];
      }

      // Fallback: если ON CONFLICT не сработал, пробуем найти существующего
      const existingPatient = await this.findPatient(message);
      if (existingPatient) {
        logger.info('Found existing patient in fallback', { patientId: existingPatient.id });
        return existingPatient;
      }

      // Если все еще не нашли, выбрасываем ошибку
      throw new Error('Failed to create or find patient');
      
    } catch (error) {
      logger.error('Error creating patient:', error);
      
      // Последняя попытка - найти существующего пациента
      const existingPatient = await this.findPatient(message);
      if (existingPatient) {
        logger.info('Recovered by finding existing patient', { patientId: existingPatient.id });
        return existingPatient;
      }
      
      throw error;
    }
  }

  // НОВЫЙ вспомогательный метод для нормализации телефона
  private normalizePhoneNumber(phone: string): string {
    // Удаляем все символы кроме цифр и +
    let normalized = phone.replace(/[^\d+]/g, '');
    
    // Убираем лидирующий + если есть
    if (normalized.startsWith('+')) {
      normalized = normalized.substring(1);
    }
    
    // Добавляем + обратно для консистентности
    if (!normalized.startsWith('+') && normalized.length >= 10) {
      normalized = '+' + normalized;
    }
    
    logger.debug('Phone normalization', { original: phone, normalized });
    return normalized;
  }

  // НОВЫЙ вспомогательный метод для нормализации chat_id
  private normalizeChatId(chatId: string): string {
    // Для WhatsApp chatId это обычно номер телефона
    // Применяем ту же нормализацию
    if (chatId && (chatId.startsWith('+') || chatId.match(/^\d{10,}$/))) {
      return this.normalizePhoneNumber(chatId);
    }
    
    // Для других платформ (Telegram) оставляем как есть
    return chatId;
  }

  // НОВЫЙ метод для миграции существующих данных
  public async migrateExistingPatients(): Promise<void> {
    try {
      logger.info('Starting patient data migration...');
      
      // Нормализуем телефоны
      await this.db.query(`
        UPDATE patients 
        SET phone = CONCAT('+', REGEXP_REPLACE(phone, '[^0-9]', '', 'g'))
        WHERE phone IS NOT NULL 
        AND phone NOT LIKE '+%'
        AND LENGTH(REGEXP_REPLACE(phone, '[^0-9]', '', 'g')) >= 10
      `);
      
      // Нормализуем chat_id для WhatsApp
      await this.db.query(`
        UPDATE patients 
        SET chat_id = CONCAT('+', REGEXP_REPLACE(chat_id, '[^0-9]', '', 'g'))
        WHERE platform = 'whatsapp'
        AND chat_id IS NOT NULL 
        AND chat_id NOT LIKE '+%'
        AND LENGTH(REGEXP_REPLACE(chat_id, '[^0-9]', '', 'g')) >= 10
      `);
      
      logger.info('Patient data migration completed');
    } catch (error) {
      logger.error('Error during patient migration:', error);
    }
  }

  private async determineClinic(message: IncomingMessage): Promise<number> {
    try {
      const clinic = await this.db.queryOne<{ id: number }>(`
        SELECT id FROM clinics WHERE is_active = true LIMIT 1
      `);

      if (!clinic) {
        const anyClinic = await this.db.queryOne<{ id: number }>(`
          SELECT id FROM clinics LIMIT 1
        `);
        
        if (!anyClinic) {
          throw new Error('No clinics found');
        }
        
        return anyClinic.id;
      }

      return clinic.id;
    } catch (error) {
      logger.error('Error determining clinic:', error);
      throw error;
    }
  }

  private async getClinic(clinicId: number): Promise<Clinic | null> {
    try {
      if (!clinicId || isNaN(clinicId)) {
        logger.error('Invalid clinicId provided', { clinicId });
        return null;
      }

      const cacheKey = `clinic:${clinicId}`;
      
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as Clinic;
        }
      } catch (redisError) {
        logger.warn('Redis cache error:', redisError);
      }

      const clinic = await this.db.queryOne<Clinic>(`
        SELECT * FROM clinics WHERE id = $1
      `, [clinicId]);

      if (clinic) {
        try {
          await this.redis.set(cacheKey, JSON.stringify(clinic), 1800);
        } catch (redisError) {
          logger.warn('Failed to cache clinic:', redisError);
        }
      }

      return clinic;
    } catch (error) {
      logger.error('Error getting clinic:', error);
      return null;
    }
  }

  private async updateSession(
    session: ChatSession, 
    intent: Intent, 
    response: BotResponse
  ): Promise<void> {
    try {
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultSessionData();
      }

      const updatedContext: ExtendedConversationContext = {
        ...session.sessionData,
        lastIntent: intent.name,
        lastResponse: response.type,
        step: response.nextStep || session.sessionData.step || '',
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
      
      session.sessionData = updatedContext;
      
    } catch (error) {
      logger.error('Error updating session:', error);
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
    }
  }

  private async checkRateLimit(chatId: string): Promise<void> {
    try {
      const key = `rate_limit:${chatId}`;
      const current = await this.redis.incr(key);
      
      if (current === 1) {
        await this.redis.expire(key, 60);
      }
      
      if (current > 30) {
        throw new Error('Rate limit exceeded');
      }
    } catch (error) {
      if ((error as Error).message === 'Rate limit exceeded') {
        throw error;
      }
      logger.error('Error in rate limiting:', error);
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

  // Публичные методы
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