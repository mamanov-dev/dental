export class PhoneUtils {
  static normalize(phone: string): string {
    // Удаляем все символы кроме цифр и +
    let normalized = phone.replace(/[^\d+]/g, '');
    
    // Конвертируем российские номера
    if (normalized.startsWith('8')) {
      normalized = '+7' + normalized.substring(1);
    } else if (normalized.startsWith('7') && normalized.length === 11) {
      normalized = '+' + normalized;
    } else if (!normalized.startsWith('+') && normalized.length === 10) {
      normalized = '+7' + normalized;
    }
    
    return normalized;
  }

  static isValid(phone: string): boolean {
    const normalized = this.normalize(phone);
    
    // Базовая валидация для российских и казахстанских номеров
    const russianPattern = /^\+7[0-9]{10}$/;
    const kazakhPattern = /^\+7[67][0-9]{9}$/;
    
    return russianPattern.test(normalized) || kazakhPattern.test(normalized);
  }

  static format(phone: string, style: 'international' | 'national' = 'international'): string {
    const normalized = this.normalize(phone);
    
    if (!this.isValid(normalized)) {
      return phone; // Возвращаем исходный если не валиден
    }
    
    if (style === 'international') {
      return normalized;
    }
    
    // Национальный формат
    if (normalized.startsWith('+7')) {
      const digits = normalized.substring(2);
      return `8 (${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6, 8)}-${digits.substring(8)}`;
    }
    
    return normalized;
  }

  static getCountryCode(phone: string): string | null {
    const normalized = this.normalize(phone);
    
    if (normalized.startsWith('+7')) {
      return 'RU'; // Или KZ в зависимости от кода региона
    }
    
    return null;
  }
}