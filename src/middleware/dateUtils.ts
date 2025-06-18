export class DateUtils {
  static formatDate(date: Date, locale: string = 'ru-RU'): string {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  static formatDateTime(date: Date, locale: string = 'ru-RU'): string {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  static formatTime(date: Date, locale: string = 'ru-RU'): string {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  static addHours(date: Date, hours: number): Date {
    const result = new Date(date);
    result.setHours(result.getHours() + hours);
    return result;
  }

  static isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }

  static getStartOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  static getEndOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  static parseTimeString(timeString: string): { hours: number; minutes: number } {
    const [hours, minutes] = timeString.split(':').map(Number);
    return { hours, minutes };
  }

  static createTimeSlots(
    startTime: string,
    endTime: string,
    durationMinutes: number
  ): string[] {
    const slots: string[] = [];
    const start = this.parseTimeString(startTime);
    const end = this.parseTimeString(endTime);
    
    let currentTime = new Date();
    currentTime.setHours(start.hours, start.minutes, 0, 0);
    
    const endTime_ = new Date();
    endTime_.setHours(end.hours, end.minutes, 0, 0);
    
    while (currentTime < endTime_) {
      slots.push(this.formatTime(currentTime));
      currentTime.setMinutes(currentTime.getMinutes() + durationMinutes);
    }
    
    return slots;
  }
}