// Базовые типы для API
export type AppointmentStatus = 
  | 'scheduled' 
  | 'confirmed' 
  | 'cancelled' 
  | 'completed' 
  | 'no_show' 
  | 'rescheduled';

export type Platform = 'whatsapp' | 'telegram' | 'web';

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: APIError;
  message?: string;
  timestamp: Date;
}

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface PaginatedResponse<T> extends APIResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateAppointmentDto {
  clinicId: number;
  doctorId: number;
  patientPhone: string;
  patientName?: string;
  appointmentDate: Date;
  serviceType?: string;
  notes?: string;
}

export interface UpdateAppointmentDto {
  appointmentDate?: Date;
  doctorId?: number;
  serviceType?: string;
  notes?: string;
  status?: AppointmentStatus;
}

export interface CreatePatientDto {
  phone: string;
  name?: string;
  preferredLanguage?: string;
  platform: Platform;
  chatId?: string;
}