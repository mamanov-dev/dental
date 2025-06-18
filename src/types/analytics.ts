export interface ClinicStats {
  todayAppointments: number;
  confirmedToday: number;
  noShowsToday: number;
  newPatientsToday: number;
  totalPatients: number;
  averageBookingTime: number;
  conversionRate: number;
  noShowRate: number;
}

export interface BotStats {
  totalConversations: number;
  conversionRate: number;
  averageConversationLength: number;
  automationRate: number;
  popularIntents: IntentStat[];
  errorRate: number;
}

export interface IntentStat {
  intent: string;
  count: number;
  successRate: number;
  averageConfidence: number;
}

export interface PerformanceMetrics {
  responseTime: number;
  throughput: number;
  errorRate: number;
  uptime: number;
  activeConnections: number;
}