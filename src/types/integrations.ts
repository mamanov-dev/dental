export interface MISConfig {
  type: 'macdent' | 'yclients' | 'custom';
  apiUrl: string;
  apiKey: string;
  additionalSettings?: Record<string, any>;
}

export interface MISAppointment {
  externalId: string;
  patientName: string;
  patientPhone: string;
  doctorName: string;
  serviceType: string;
  appointmentDate: Date;
  duration: number;
  status: string;
  notes?: string;
}

export interface AvailabilitySlot {
  doctorId: number;
  date: Date;
  startTime: string;
  endTime: string;
  available: boolean;
  serviceTypes?: string[];
}