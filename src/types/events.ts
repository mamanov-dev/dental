export interface AppointmentEvent {
  type: 'created' | 'updated' | 'cancelled' | 'confirmed' | 'completed' | 'no_show';
  appointmentId: number;
  clinicId: number;
  patientId: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface MessageEvent {
  type: 'received' | 'sent' | 'failed';
  sessionId: number;
  platform: Platform;
  messageId?: string;
  content: string;
  timestamp: Date;
}

export interface SystemEvent {
  type: 'integration_sync' | 'reminder_sent' | 'error' | 'performance_alert';
  level: 'info' | 'warning' | 'error' | 'critical';
  message: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}