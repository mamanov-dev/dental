import { 
  ChatSession, 
  BotResponse, 
  Intent, 
  Clinic,
  ResponseOption
} from '@/types';
import { DatabaseService } from '@/config/database';
import logger from '@/config/logger';

// Локальные интерфейсы для ConversationManager
interface ValidationRule {
  type: 'required' | 'phone' | 'date' | 'time' | 'custom';
  message: string;
  validator?: (value: string) => boolean;
}

interface FlowStep {
  id: string;
  message: string;
  type: 'input' | 'selection' | 'confirmation' | 'info';
  validation?: ValidationRule[];
  options?: ResponseOption[];
  nextStep?: string | ((context: any) => string);
}

interface ConversationFlow {
  id: string;
  name: string;
  steps: FlowStep[];
  fallbackStep?: string;
}

// Интерфейс для врача из БД
interface DoctorRow {
  id: number;
  name: string;
  specialization: string;
}

// ИСПРАВЛЕННЫЙ интерфейс для данных контекста
interface BookingData {
  patientName?: string;
  patientPhone?: string;
  serviceType?: string;
  serviceDisplayName?: string;  // ДОБАВЛЕНО: человекочитаемое название
  doctorId?: number;
  selectedDate?: string;
  selectedTime?: string;
}

export class ConversationManager {
  private db: DatabaseService;
  private flows: Map<string, ConversationFlow> = new Map();

  constructor() {
    this.db = DatabaseService.getInstance();
    this.initializeFlows();
  }

  // Метод для создания дефолтного контекста
  private createDefaultContext(): any {
    return {
      flow: '',
      step: '',
      data: {},
      retryCount: 0,
      startTime: new Date()
    };
  }

  // ОБНОВЛЕНО: initializeFlows с добавленным потоком отмены
  private initializeFlows(): void {
    // Поток записи на прием
    const bookingFlow: ConversationFlow = {
      id: 'BOOKING',
      name: 'Запись на прием',
      steps: [
        {
          id: 'COLLECT_NAME',
          message: 'Как вас зовут?',
          type: 'input',
          validation: [{ type: 'required', message: 'Пожалуйста, укажите ваше имя' }]
        },
        {
          id: 'COLLECT_PHONE',
          message: 'Укажите ваш номер телефона',
          type: 'input',
          validation: [
            { type: 'required', message: 'Номер телефона обязателен' },
            { type: 'phone', message: 'Неверный формат номера телефона' }
          ]
        },
        {
          id: 'SELECT_SERVICE',
          message: 'Какая услуга вас интересует?',
          type: 'selection',
          options: [
            { id: 'consultation', text: 'Консультация', value: 'consultation' },
            { id: 'cleaning', text: 'Профессиональная чистка', value: 'cleaning' },
            { id: 'treatment', text: 'Лечение', value: 'treatment' },
            { id: 'prosthetics', text: 'Протезирование', value: 'prosthetics' }
          ]
        },
        {
          id: 'SELECT_DOCTOR',
          message: 'Выберите врача',
          type: 'selection'
        },
        {
          id: 'SELECT_DATE',
          message: 'Выберите удобную дату',
          type: 'selection'
        },
        {
          id: 'SELECT_TIME',
          message: 'Выберите время',
          type: 'selection'
        },
        {
          id: 'CONFIRMATION',
          message: 'Подтвердите запись',
          type: 'confirmation'
        }
      ]
    };

    // ДОБАВЛЕНО: Поток отмены записи
    const cancellationFlow: ConversationFlow = {
      id: 'CANCELLATION',
      name: 'Отмена записи',
      steps: [
        {
          id: 'SELECT_APPOINTMENT',
          message: 'Выберите запись для отмены',
          type: 'selection'
        },
        {
          id: 'CONFIRM_CANCELLATION',
          message: 'Подтвердите отмену',
          type: 'confirmation'
        }
      ]
    };

    this.flows.set('BOOKING', bookingFlow);
    this.flows.set('CANCELLATION', cancellationFlow); // ДОБАВЛЕНО
  }

  async handleBookingFlow(session: ChatSession, intent: Intent, clinic: Clinic): Promise<BotResponse> {
    try {
      // Проверяем и создаем sessionData если нужно
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultContext();
        logger.warn('Created default session data for booking flow');
      }

      const context = session.sessionData;
      
      // Инициализируем поток записи
      context.flow = 'BOOKING';
      context.step = 'COLLECT_NAME';
      context.data = context.data || {};

      logger.info('Starting booking flow', { 
        sessionId: session.id, 
        flow: context.flow, 
        step: context.step 
      });

      // Сохраняем обновленный контекст в БД сразу
      await this.db.query(`
        UPDATE chat_sessions SET session_data = $1 WHERE id = $2
      `, [JSON.stringify(context), session.id]);

      return this.executeFlowStep(session, 'COLLECT_NAME', clinic);
    } catch (error) {
      logger.error('Error in handleBookingFlow:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка при запуске записи на прием. Попробуйте снова.'
      };
    }
  }

  // ДОБАВЛЕНО: метод handleCancellationFlow
  async handleCancellationFlow(session: ChatSession, intent: Intent, clinic: Clinic): Promise<BotResponse> {
    try {
      // Проверяем и создаем sessionData если нужно
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultContext();
        logger.warn('Created default session data for cancellation flow');
      }

      const context = session.sessionData;
      
      // Инициализируем поток отмены
      context.flow = 'CANCELLATION';
      context.step = 'SELECT_APPOINTMENT';
      context.data = context.data || {};

      logger.info('Starting cancellation flow', { 
        sessionId: session.id, 
        flow: context.flow, 
        step: context.step 
      });

      // Сохраняем обновленный контекст в БД сразу
      await this.db.query(`
        UPDATE chat_sessions SET session_data = $1 WHERE id = $2
      `, [JSON.stringify(context), session.id]);

      return this.executeCancellationStep(session, 'SELECT_APPOINTMENT', clinic);
    } catch (error) {
      logger.error('Error in handleCancellationFlow:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка при загрузке списка записей. Попробуйте снова.'
      };
    }
  }

  // ОБНОВЛЕНО: handleCurrentFlow с добавленной обработкой отмены
  async handleCurrentFlow(session: ChatSession, userInput: string, clinic: Clinic): Promise<BotResponse> {
    try {
      // Проверяем и создаем sessionData если нужно
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultContext();
        logger.warn('Created default session data for current flow');
      }

      const context = session.sessionData;
      
      // Если нет активного потока, переводим в fallback
      if (!context.flow || !context.step) {
        logger.warn('No active flow found, returning to main menu');
        return {
          type: 'text',
          text: 'Не понимаю. Попробуйте начать сначала, написав "привет".'
        };
      }

      // ДОБАВЛЕНО: Обработка потока отмены
      if (context.flow === 'CANCELLATION') {
        return this.handleCancellationFlowStep(session, userInput, clinic);
      }

      // Существующая логика для потока BOOKING
      const flow = this.flows.get(context.flow);
      if (!flow) {
        logger.error('Flow not found:', context.flow);
        // Сбрасываем поток
        context.flow = '';
        context.step = '';
        await this.db.query(`
          UPDATE chat_sessions SET session_data = $1 WHERE id = $2
        `, [JSON.stringify(context), session.id]);
        
        return {
          type: 'text',
          text: 'Произошла ошибка. Начните сначала.'
        };
      }

      const currentStep = flow.steps.find((s: FlowStep) => s.id === context.step);
      if (!currentStep) {
        logger.error('Current step not found:', context.step);
        // Сбрасываем поток
        context.flow = '';
        context.step = '';
        await this.db.query(`
          UPDATE chat_sessions SET session_data = $1 WHERE id = $2
        `, [JSON.stringify(context), session.id]);
        
        return {
          type: 'text',
          text: 'Произошла ошибка в диалоге. Начните сначала.'
        };
      }

      // Специальная обработка для шага подтверждения записи
      if (context.step === 'CONFIRMATION') {
        logger.info('Processing confirmation step', { userInput });
        
        if (userInput === 'confirm') {
          logger.info('User confirmed booking, completing...');
          return this.completeBooking(session, clinic);
        } else if (userInput === 'cancel') {
          logger.info('User cancelled booking');
          // Сбрасываем контекст сессии
          context.flow = '';
          context.step = '';
          context.data = {};

          await this.db.query(`
            UPDATE chat_sessions SET session_data = $1 WHERE id = $2
          `, [JSON.stringify(context), session.id]);

          return {
            type: 'text',
            text: '❌ Запись отменена. Если захотите записаться снова, напишите "привет".'
          };
        } else {
          return {
            type: 'text',
            text: 'Пожалуйста, выберите "Подтвердить" или "Отменить".'
          };
        }
      }

      // Валидируем ввод пользователя для других шагов
      const validation = this.validateInput(userInput, currentStep);
      if (!validation.valid) {
        return {
          type: 'text',
          text: validation.message || 'Неверный ввод. Попробуйте снова.'
        };
      }

      // Сохраняем данные
      await this.saveStepData(session, currentStep, userInput);

      // Переходим к следующему шагу
      const nextStepId = this.getNextStepId(flow, currentStep, context);
      if (!nextStepId) {
        // Поток завершен (не должно происходить, так как CONFIRMATION обрабатывается выше)
        logger.warn('Flow completed without confirmation step');
        return this.completeBooking(session, clinic);
      }

      return this.executeFlowStep(session, nextStepId, clinic);
    } catch (error) {
      logger.error('Error in handleCurrentFlow:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка. Попробуйте снова.'
      };
    }
  }

  // ДОБАВЛЕНО: метод executeCancellationStep
  private async executeCancellationStep(session: ChatSession, stepId: string, clinic: Clinic): Promise<BotResponse> {
    try {
      const context = session.sessionData;
      
      // Обновляем текущий шаг
      context.step = stepId;
      
      // Сохраняем в БД
      await this.db.query(`
        UPDATE chat_sessions SET session_data = $1 WHERE id = $2
      `, [JSON.stringify(context), session.id]);

      logger.info('Executing cancellation step:', { 
        stepId, 
        sessionId: session.id 
      });

      switch (stepId) {
        case 'SELECT_APPOINTMENT':
          return await this.showAppointmentsForCancellation(session, clinic);
        
        case 'CONFIRM_CANCELLATION':
          return this.generateCancellationConfirmation(context, clinic);
        
        default:
          return {
            type: 'text',
            text: 'Произошла ошибка. Начните сначала.'
          };
      }
    } catch (error) {
      logger.error('Error executing cancellation step:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка. Попробуйте снова.'
      };
    }
  }

  // ДОБАВЛЕНО: метод showAppointmentsForCancellation
  private async showAppointmentsForCancellation(session: ChatSession, clinic: Clinic): Promise<BotResponse> {
    try {
      // Ищем активные записи пациента
      const appointments = await this.db.query<any>(`
        SELECT 
          a.id,
          a.appointment_date,
          a.service_type,
          d.name as doctor_name 
        FROM appointments a
        JOIN doctors d ON a.doctor_id = d.id
        WHERE a.patient_id = $1 
        AND a.status IN ('scheduled', 'confirmed')
        AND a.appointment_date > NOW()
        ORDER BY a.appointment_date
      `, [session.patientId]);

      if (appointments.rows.length === 0) {
        // Сбрасываем поток если нет записей
        const context = session.sessionData;
        context.flow = '';
        context.step = '';
        context.data = {};

        await this.db.query(`
          UPDATE chat_sessions SET session_data = $1 WHERE id = $2
        `, [JSON.stringify(context), session.id]);

        return {
          type: 'text',
          text: '📅 У вас нет активных записей для отмены.\n\nМожете записаться на новый прием, написав "привет".'
        };
      }

      const options: ResponseOption[] = appointments.rows.map((apt: any) => {
        const appointmentDate = new Date(apt.appointment_date);
        const formattedDate = new Intl.DateTimeFormat('ru-RU', {
          weekday: 'short',
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        }).format(appointmentDate);

        return {
          id: apt.id.toString(),
          text: `${formattedDate} - ${apt.doctor_name}`,
          value: apt.id.toString(),
          description: apt.service_type
        };
      });

      // Добавляем кнопку отмены
      options.push({
        id: 'back',
        text: '🔙 Назад в главное меню',
        value: 'back_to_menu'
      });

      return {
        type: 'list',
        text: '📋 Ваши активные записи:\n\nВыберите запись для отмены:',
        options
      };
    } catch (error) {
      logger.error('Error showing appointments for cancellation:', error);
      return {
        type: 'text',
        text: '❌ Ошибка при загрузке списка записей.'
      };
    }
  }

  // ДОБАВЛЕНО: метод generateCancellationConfirmation
  private generateCancellationConfirmation(context: any, clinic: Clinic): BotResponse {
    const data = context.data;
    const { selectedAppointment } = data;
    
    return {
      type: 'keyboard',
      text: `❌ Подтвердите отмену записи:\n\n` +
            `📋 Запись: ${selectedAppointment?.displayText || 'Не указана'}\n` +
            `🏥 Клиника: ${clinic.name}\n\n` +
            `⚠️ Отменить эту запись?`,
      options: [
        { id: 'confirm_cancel', text: '✅ Да, отменить', value: 'confirm_cancel' },
        { id: 'keep', text: '❌ Нет, оставить', value: 'keep_appointment' }
      ],
      nextStep: 'CONFIRM_CANCELLATION'
    };
  }

  // ДОБАВЛЕНО: метод handleCancellationFlowStep
  private async handleCancellationFlowStep(session: ChatSession, userInput: string, clinic: Clinic): Promise<BotResponse> {
    try {
      const context = session.sessionData;
      
      logger.info('Processing cancellation flow step', { 
        step: context.step, 
        userInput, 
        sessionId: session.id 
      });

      switch (context.step) {
        case 'SELECT_APPOINTMENT':
          if (userInput === 'back_to_menu') {
            // Возвращаемся в главное меню
            context.flow = '';
            context.step = '';
            context.data = {};

            await this.db.query(`
              UPDATE chat_sessions SET session_data = $1 WHERE id = $2
            `, [JSON.stringify(context), session.id]);

            return {
              type: 'text',
              text: 'Вы вернулись в главное меню. Напишите "привет" для продолжения.'
            };
          }

          // Сохраняем выбранную запись
          const appointmentId = parseInt(userInput);
          if (isNaN(appointmentId)) {
            return {
              type: 'text',
              text: 'Пожалуйста, выберите запись из списка.'
            };
          }

          // Получаем детали записи
          const appointment = await this.db.queryOne<any>(`
            SELECT 
              a.id,
              a.appointment_date,
              a.service_type,
              d.name as doctor_name 
            FROM appointments a
            JOIN doctors d ON a.doctor_id = d.id
            WHERE a.id = $1 AND a.patient_id = $2
          `, [appointmentId, session.patientId]);

          if (!appointment) {
            return {
              type: 'text',
              text: 'Запись не найдена. Попробуйте выбрать из списка.'
            };
          }

          // Сохраняем данные о выбранной записи
          context.data = {
            selectedAppointmentId: appointmentId,
            selectedAppointment: {
              id: appointment.id,
              displayText: `${this.formatDate(appointment.appointment_date)} - ${appointment.doctor_name} (${appointment.service_type})`
            }
          };
          context.step = 'CONFIRM_CANCELLATION';

          await this.db.query(`
            UPDATE chat_sessions SET session_data = $1 WHERE id = $2
          `, [JSON.stringify(context), session.id]);

          return this.generateCancellationConfirmation(context, clinic);

        case 'CONFIRM_CANCELLATION':
          if (userInput === 'confirm_cancel') {
            return this.completeCancellation(session, clinic);
          } else if (userInput === 'keep_appointment') {
            // Сбрасываем поток и возвращаемся в меню
            context.flow = '';
            context.step = '';
            context.data = {};

            await this.db.query(`
              UPDATE chat_sessions SET session_data = $1 WHERE id = $2
            `, [JSON.stringify(context), session.id]);

            return {
              type: 'text',
              text: '✅ Запись сохранена. Ждем вас в назначенное время!\n\nНапишите "привет" для возврата в главное меню.'
            };
          } else {
            return {
              type: 'text',
              text: 'Пожалуйста, выберите "Да, отменить" или "Нет, оставить".'
            };
          }

        default:
          return {
            type: 'text',
            text: 'Произошла ошибка в процессе отмены. Попробуйте снова.'
          };
      }
    } catch (error) {
      logger.error('Error in handleCancellationFlowStep:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка при отмене записи.'
      };
    }
  }

  // ДОБАВЛЕНО: метод completeCancellation
  private async completeCancellation(session: ChatSession, clinic: Clinic): Promise<BotResponse> {
    try {
      const context = session.sessionData;
      const data = context.data;
      const appointmentId = data.selectedAppointmentId;

      logger.info('Completing cancellation', { 
        appointmentId, 
        sessionId: session.id 
      });

      // Отменяем запись в БД
      const result = await this.db.query<any>(`
        UPDATE appointments 
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = $1 AND patient_id = $2
        RETURNING id, appointment_date, service_type
      `, [appointmentId, session.patientId]);

      if (result.rows.length === 0) {
        return {
          type: 'text',
          text: '❌ Не удалось отменить запись. Возможно, она уже была отменена.'
        };
      }

      const cancelledAppointment = result.rows[0];

      // Сбрасываем контекст сессии
      context.flow = '';
      context.step = '';
      context.data = {};

      await this.db.query(`
        UPDATE chat_sessions SET session_data = $1 WHERE id = $2
      `, [JSON.stringify(context), session.id]);

      return {
        type: 'text',
        text: `✅ Запись успешно отменена!\n\n` +
              `📋 Номер записи: ${cancelledAppointment.id}\n` +
              `📅 Дата: ${this.formatDate(cancelledAppointment.appointment_date)}\n` +
              `🦷 Услуга: ${cancelledAppointment.service_type}\n\n` +
              `Если захотите записаться снова, напишите "привет".`
      };

    } catch (error) {
      logger.error('Error completing cancellation:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка при отмене записи. Попробуйте снова или обратитесь в клинику.'
      };
    }
  }

  private async executeFlowStep(session: ChatSession, stepId: string, clinic: Clinic): Promise<BotResponse> {
    try {
      // Проверяем sessionData
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultContext();
      }

      const context = session.sessionData;
      const flow = this.flows.get(context.flow);
      const step = flow?.steps.find((s: FlowStep) => s.id === stepId);

      if (!step) {
        logger.error('Step not found:', stepId);
        return {
          type: 'text',
          text: 'Произошла ошибка. Начните сначала.'
        };
      }

      // Обновляем текущий шаг
      context.step = stepId;
      
      // Сохраняем в БД
      await this.db.query(`
        UPDATE chat_sessions SET session_data = $1 WHERE id = $2
      `, [JSON.stringify(context), session.id]);

      logger.info('Executing flow step:', { 
        stepId, 
        sessionId: session.id 
      });

      switch (step.id) {
        case 'COLLECT_NAME':
        case 'COLLECT_PHONE':
          return {
            type: 'text',
            text: step.message,
            nextStep: step.id
          };

        case 'SELECT_SERVICE':
          return {
            type: 'keyboard',
            text: step.message,
            options: step.options || [],
            nextStep: step.id
          };

        case 'SELECT_DOCTOR':
          const doctors = await this.getAvailableDoctors(clinic.id, (context.data as BookingData).serviceType);
          return {
            type: 'keyboard',
            text: step.message,
            options: doctors.map((d: DoctorRow) => ({
              id: d.id.toString(),
              text: d.name,
              value: d.id.toString(),
              description: d.specialization
            })),
            nextStep: step.id
          };

        case 'SELECT_DATE':
          const dates = await this.getAvailableDates((context.data as BookingData).doctorId || 0);
          return {
            type: 'keyboard',
            text: step.message,
            options: dates.map(date => ({
              id: date,
              text: this.formatDateOption(date),
              value: date
            })),
            nextStep: step.id
          };

        case 'SELECT_TIME':
          const times = await this.getAvailableTimes(
            (context.data as BookingData).doctorId || 0, 
            (context.data as BookingData).selectedDate || ''
          );
          return {
            type: 'keyboard',
            text: step.message,
            options: times.map(time => ({
              id: time,
              text: time,
              value: time
            })),
            nextStep: step.id
          };

        case 'CONFIRMATION':
          return this.generateConfirmationMessage(context, clinic);

        default:
          return {
            type: 'text',
            text: 'Произошла ошибка. Начните сначала.'
          };
      }
    } catch (error) {
      logger.error('Error executing flow step:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка. Попробуйте снова.'
      };
    }
  }

  private validateInput(input: string, step: FlowStep): { valid: boolean; message?: string } {
    if (!step.validation) return { valid: true };

    for (const rule of step.validation) {
      switch (rule.type) {
        case 'required':
          if (!input.trim()) {
            return { valid: false, message: rule.message };
          }
          break;

        case 'phone':
          const phoneRegex = /^\+?[7-8][\d\s\-\(\)]{10,}$/;
          if (!phoneRegex.test(input.replace(/\s/g, ''))) {
            return { valid: false, message: rule.message };
          }
          break;

        case 'custom':
          if (rule.validator && !rule.validator(input)) {
            return { valid: false, message: rule.message };
          }
          break;
      }
    }

    return { valid: true };
  }

  // ИСПРАВЛЕННЫЙ метод saveStepData
  private async saveStepData(session: ChatSession, step: FlowStep, input: string): Promise<void> {
    try {
      // Проверяем sessionData
      if (!session.sessionData || typeof session.sessionData !== 'object') {
        session.sessionData = this.createDefaultContext();
      }

      const context = session.sessionData;
      const data = context.data as BookingData;
      
      switch (step.id) {
        case 'COLLECT_NAME':
          data.patientName = input.trim();
          // Обновляем имя пациента в БД
          await this.db.query(`
            UPDATE patients SET name = $1 WHERE id = $2
          `, [input.trim(), session.patientId]);
          logger.info('Saved patient name:', input.trim());
          break;

        case 'COLLECT_PHONE':
          data.patientPhone = input.trim();
          // ИСПРАВЛЕНО: Обновляем номер телефона пациента в БД
          await this.db.query(`
            UPDATE patients SET phone = $1 WHERE id = $2
          `, [input.trim(), session.patientId]);
          logger.info('Saved patient phone:', input.trim());
          break;

        case 'SELECT_SERVICE':
          // ИСПРАВЛЕНО: Сохраняем и код услуги, и человекочитаемое название
          data.serviceType = input;
          
          // Преобразуем код в читаемое название
          const serviceNames: Record<string, string> = {
            'consultation': 'Консультация',
            'cleaning': 'Профессиональная чистка',
            'treatment': 'Лечение',
            'prosthetics': 'Протезирование'
          };
          
          data.serviceDisplayName = serviceNames[input] || input;
          logger.info('Saved service type:', { code: input, display: data.serviceDisplayName });
          break;

        case 'SELECT_DOCTOR':
          data.doctorId = parseInt(input);
          logger.info('Saved doctor ID:', input);
          break;

        case 'SELECT_DATE':
          data.selectedDate = input;
          logger.info('Saved selected date:', input);
          break;

        case 'SELECT_TIME':
          data.selectedTime = input;
          logger.info('Saved selected time:', input);
          break;
      }

      // Обновляем сессию в БД
      await this.db.query(`
        UPDATE chat_sessions SET session_data = $1 WHERE id = $2
      `, [JSON.stringify(context), session.id]);
      
      logger.info('Step data saved successfully', { 
        step: step.id, 
        sessionId: session.id,
        data: data
      });
    } catch (error) {
      logger.error('Error saving step data:', error);
      throw error;
    }
  }

  private getNextStepId(flow: ConversationFlow, currentStep: FlowStep, context: any): string | null {
    const currentIndex = flow.steps.findIndex((s: FlowStep) => s.id === currentStep.id);
    const nextStep = flow.steps[currentIndex + 1];
    return nextStep ? nextStep.id : null;
  }

  private async getAvailableDoctors(clinicId: number, serviceType?: string): Promise<DoctorRow[]> {
    try {
      let query = `
        SELECT id, name, specialization 
        FROM doctors 
        WHERE clinic_id = $1 AND is_active = true
      `;
      const params: any[] = [clinicId];

      if (serviceType) {
        query += ` AND services::jsonb ? $2`;
        params.push(serviceType);
      }

      const result = await this.db.query<DoctorRow>(query, params);
      
      // Если нет врачей с нужной услугой, возвращаем всех врачей
      if (result.rows.length === 0 && serviceType) {
        const fallbackResult = await this.db.query<DoctorRow>(`
          SELECT id, name, specialization 
          FROM doctors 
          WHERE clinic_id = $1 AND is_active = true
        `, [clinicId]);
        return fallbackResult.rows;
      }
      
      return result.rows;
    } catch (error) {
      logger.error('Error getting doctors:', error);
      // Возвращаем тестовых врачей
      return [
        { id: 1, name: 'Доктор Иванов', specialization: 'Терапевт' },
        { id: 2, name: 'Доктор Петрова', specialization: 'Хирург' }
      ];
    }
  }

  private async getAvailableDates(doctorId: number): Promise<string[]> {
    // Возвращаем ближайшие 7 дней (упрощенная логика для MVP)
    const dates = [];
    const today = new Date();
    
    for (let i = 1; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
  }

  private async getAvailableTimes(doctorId: number, date: string): Promise<string[]> {
    // Упрощенная логика - возвращаем стандартные часы работы
    return ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00'];
  }

  // ИСПРАВЛЕННЫЙ метод generateConfirmationMessage
  private generateConfirmationMessage(context: any, clinic: Clinic): BotResponse {
    const data = context.data as BookingData & { serviceDisplayName?: string };
    const { patientName, serviceType, serviceDisplayName, selectedDate, selectedTime } = data;
    
    // Используем человекочитаемое название услуги
    const displayService = serviceDisplayName || serviceType || 'Не указана';
    
    logger.info('Generating confirmation with data:', {
      patientName,
      serviceType,
      serviceDisplayName,
      displayService,
      selectedDate,
      selectedTime
    });
    
    return {
      type: 'keyboard',
      text: `📋 Подтвердите запись:\n\n` +
            `👤 Пациент: ${patientName}\n` +
            `🏥 Клиника: ${clinic.name}\n` +
            `🦷 Услуга: ${displayService}\n` +
            `📅 Дата: ${this.formatDateOption(selectedDate || '')}\n` +
            `⏰ Время: ${selectedTime}\n\n` +
            `Все верно?`,
      options: [
        { id: 'confirm', text: '✅ Подтвердить', value: 'confirm' },
        { id: 'cancel', text: '❌ Отменить', value: 'cancel' }
      ],
      nextStep: 'CONFIRMATION'
    };
  }

  // ИСПРАВЛЕННЫЙ метод completeBooking
  private async completeBooking(session: ChatSession, clinic: Clinic): Promise<BotResponse> {
    const context = session.sessionData;
    const data = context.data as BookingData;
    const { doctorId, selectedDate, selectedTime, serviceType, serviceDisplayName } = data;

    try {
      logger.info('Completing booking with data:', {
        doctorId,
        selectedDate,
        selectedTime,
        serviceType,
        serviceDisplayName,
        patientId: session.patientId,
        clinicId: clinic.id
      });

      // Проверяем, что все необходимые данные есть
      if (!doctorId || !selectedDate || !selectedTime || !serviceType) {
        logger.error('Missing required booking data:', { doctorId, selectedDate, selectedTime, serviceType });
        return {
          type: 'text',
          text: '❌ Не хватает данных для создания записи. Попробуйте начать заново.'
        };
      }

      // Создаем запись в БД
      const appointmentDate = new Date(`${selectedDate}T${selectedTime}:00`);
      
      // Используем человекочитаемое название услуги
      const serviceToSave = serviceDisplayName || serviceType;
      
      const result = await this.db.query<{ id: number }>(`
        INSERT INTO appointments (
          clinic_id, doctor_id, patient_id, appointment_date, 
          service_type, status, confirmed, created_at
        )
        VALUES ($1, $2, $3, $4, $5, 'scheduled', false, NOW())
        RETURNING id
      `, [
        clinic.id,
        doctorId,
        session.patientId,
        appointmentDate,
        serviceToSave  // Используем читаемое название
      ]);

      const appointmentId = result.rows[0].id;

      logger.info('Appointment created successfully', {
        appointmentId,
        serviceType: serviceToSave,
        appointmentDate,
        patientId: session.patientId,
        doctorId,
        clinicId: clinic.id
      });

      // Сбрасываем контекст сессии
      context.flow = '';
      context.step = '';
      context.data = {};

      await this.db.query(`
        UPDATE chat_sessions SET session_data = $1 WHERE id = $2
      `, [JSON.stringify(context), session.id]);

      return {
        type: 'text',
        text: `✅ Запись успешно создана!\n\n` +
              `📋 Номер записи: ${appointmentId}\n` +
              `🦷 Услуга: ${serviceToSave}\n` +
              `📅 Дата: ${this.formatDateOption(selectedDate || '')} в ${selectedTime}\n\n` +
              `Мы отправим вам напоминание за день до приема.\n` +
              `Если планы изменятся, сообщите нам заранее.`
      };

    } catch (error) {
      logger.error('Error completing booking:', error);
      return {
        type: 'text',
        text: '❌ Произошла ошибка при создании записи. Попробуйте снова или обратитесь по телефону клиники.'
      };
    }
  }

  private formatDateOption(dateString: string): string {
    if (!dateString) return 'Дата не указана';
    
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit'
    }).format(date);
  }

  // ДОБАВЛЕНО: вспомогательный метод formatDate
  private formatDate(date: Date | string): string {
    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;
      return new Intl.DateTimeFormat('ru-RU', {
        weekday: 'long',
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
}