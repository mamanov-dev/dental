export interface Clinic {
  id: number;
  name: string;
  phone: string;
  address: string;
  timezone: string;
  settings: ClinicSettings;
  createdAt: Date;
  updatedAt?: Date;
}

export interface ClinicSettings {
  workingHours: WorkingHours;
  appointmentDuration: number;
  maxAdvanceBookingDays: number;
  reminderSettings: ReminderSettings;
  autoConfirmation: boolean;
  languages: string[];
  services: ServiceType[];
}

export interface WorkingHours {
  [key: string]: DaySchedule | null; // monday, tuesday, etc.
}

export interface DaySchedule {
  start: string; // "09:00"
  end: string;   // "18:00"
  breaks?: TimeSlot[];
}

export interface TimeSlot {
  start: string;
  end: string;
  available?: boolean;
}

export interface Doctor {
  id: number;
  clinicId: number;
  name: string;
  specialization: string;
  workingHours: WorkingHours;
  isActive: boolean;
  services: string[];
}

export interface Patient {
  id: number;
  phone: string;
  name?: string;
  chatId?: string;
  preferredLanguage: string;
  platform: Platform;
  createdAt: Date;
  lastActivity?: Date;
}

export interface Appointment {
  id: number;
  clinicId: number;
  doctorId: number;
  patientId: number;
  appointmentDate: Date;
  duration: number;
  status: AppointmentStatus;
  serviceType?: string;
  notes?: string;
  confirmed: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export type AppointmentStatus = 
  | 'scheduled' 
  | 'confirmed' 
  | 'cancelled' 
  | 'completed' 
  | 'no_show' 
  | 'rescheduled';

export type Platform = 'whatsapp' | 'telegram' | 'web';

export interface ChatSession {
  id: number;
  patientId: number;
  clinicId: number;
  platform: Platform;
  sessionData: ConversationContext;
  lastActivity: Date;
  isActive: boolean;
}

export interface ConversationContext {
  flow: string;
  step: string;
  data: Record<string, any>;
  retryCount: number;
  startTime: Date;
}

export interface IncomingMessage {
  platform: Platform;
  chatId: string;
  text: string;
  phone?: string;
  messageId?: string;
  timestamp: Date;
  isButton?: boolean;
  buttonData?: string;
}

export interface BotResponse {
  type: 'text' | 'keyboard' | 'list' | 'image';
  text: string;
  options?: ResponseOption[];
  nextStep?: string;
  metadata?: Record<string, any>;
}

export interface ResponseOption {
  id: string;
  text: string;
  value: string;
  description?: string;
}

export interface Intent {
  name: string;
  confidence: number;
  entities: Entity[];
  context: ConversationContext;
}

export interface Entity {
  type: string;
  value: string;
  confidence: number;
  start: number;
  end: number;
}

export interface ServiceType {
  id: string;
  name: string;
  duration: number;
  price?: number;
  description?: string;
  available: boolean;
}

export interface ReminderSettings {
  enabled: boolean;
  times: ReminderTime[];
  channels: Platform[];
}

export interface ReminderTime {
  hours: number; // hours before appointment
  message: string;
}