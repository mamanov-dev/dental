// Импортируем необходимые типы из основного файла типов
import { ChatSession, BotResponse, ConversationContext, ResponseOption } from './index';

export interface FlowStep {
  id: string;
  message: string;
  type: 'input' | 'selection' | 'confirmation' | 'info';
  validation?: ValidationRule[];
  options?: ResponseOption[];
  nextStep?: string | ((context: ConversationContext) => string);
}

export interface ValidationRule {
  type: 'required' | 'phone' | 'date' | 'time' | 'custom';
  message: string;
  validator?: (value: string) => boolean;
}

export interface ConversationFlow {
  id: string;
  name: string;
  steps: FlowStep[];
  fallbackStep?: string;
}

export interface BotCommand {
  command: string;
  description: string;
  handler: (session: ChatSession, args: string[]) => Promise<BotResponse>;
}

// Дополнительные интерфейсы для бота
export interface BotState {
  currentFlow?: string;
  currentStep?: string;
  data: Record<string, any>;
  retryCount: number;
  lastActivity: Date;
}

export interface FlowContext {
  session: ChatSession;
  state: BotState;
  input: string;
  metadata?: Record<string, any>;
}

export interface BotAction {
  type: 'message' | 'flow_change' | 'data_update' | 'external_api';
  payload: any;
}

export interface FlowTrigger {
  type: 'keyword' | 'pattern' | 'intent' | 'button';
  value: string | RegExp;
  flowId: string;
  priority?: number;
}

export interface BotConfig {
  defaultLanguage: string;
  fallbackFlow: string;
  maxRetries: number;
  sessionTimeout: number; // в минутах
  enableTyping: boolean;
  flows: ConversationFlow[];
  triggers: FlowTrigger[];
  commands: BotCommand[];
}

// Типы для различных платформ
export interface PlatformMessage {
  id: string;
  chatId: string;
  userId: string;
  text: string;
  timestamp: Date;
  platform: 'whatsapp' | 'telegram' | 'web';
  messageType: 'text' | 'button' | 'location' | 'contact' | 'image';
  metadata?: Record<string, any>;
}

export interface PlatformResponse {
  chatId: string;
  message: BotResponse;
  platform: 'whatsapp' | 'telegram' | 'web';
  delay?: number; // задержка перед отправкой в мс
}

// Интерфейсы для обработки намерений (intents)
export interface IntentProcessor {
  name: string;
  confidence: number;
  handler: (context: FlowContext) => Promise<BotResponse>;
}

export interface NLUResult {
  intent: string;
  confidence: number;
  entities: Entity[];
  text: string;
}

export interface Entity {
  type: string;
  value: string;
  confidence: number;
  start: number;
  end: number;
}

// Типы для веб-хуков и интеграций
export interface WebhookPayload {
  platform: string;
  chatId: string;
  message: PlatformMessage;
  verification?: string;
}

// Типы для метрик и аналитики бота
export interface BotMetrics {
  totalMessages: number;
  successfulFlows: number;
  failedFlows: number;
  averageSessionDuration: number;
  mostUsedFlows: string[];
  errorRate: number;
}

export interface SessionMetrics {
  sessionId: string;
  startTime: Date;
  endTime?: Date;
  messageCount: number;
  flowsCompleted: string[];
  errors: string[];
  platform: string;
}