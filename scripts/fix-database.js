// Файл: scripts/fix-database.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

async function fixDatabase() {
  // Для запуска вне Docker используем localhost вместо db
  let connectionString = process.env.DATABASE_URL;
  if (connectionString && connectionString.includes('@db:')) {
    connectionString = connectionString.replace('@db:', '@localhost:');
    console.log('🔄 Изменено подключение с db на localhost для внешнего запуска');
  }
  
  const pool = new Pool({
    connectionString: connectionString
  });

  try {
    console.log('🔧 Применение исправлений базы данных...');
    
    // Читаем SQL файл с исправлениями
    const fixPath = path.join(__dirname, 'fix-database.sql');
    
    // Если файл не существует, создаем SQL команды напрямую
    const fixSQL = `
-- Исправление схемы базы данных для поддержки Telegram пользователей

-- 1. Удаляем ограничение NOT NULL с поля phone
ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;

-- 2. Добавляем ограничение: должен быть указан либо phone, либо chat_id
ALTER TABLE patients ADD CONSTRAINT patients_contact_check 
CHECK (phone IS NOT NULL OR chat_id IS NOT NULL);

-- 3. Создаем составной уникальный индекс для chat_id + platform
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_chat_platform 
ON patients(chat_id, platform) 
WHERE chat_id IS NOT NULL;

-- 4. Обновляем существующий уникальный индекс на phone 
DROP INDEX IF EXISTS patients_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_phone_unique 
ON patients(phone) 
WHERE phone IS NOT NULL;
`;
    
    // Выполняем исправления
    await pool.query(fixSQL);
    
    console.log('✅ Исправления успешно применены');
    console.log('📝 Изменения:');
    console.log('   - Поле phone теперь может быть NULL');
    console.log('   - Добавлено ограничение: phone ИЛИ chat_id должен быть указан');
    console.log('   - Создан уникальный индекс для chat_id + platform');
    console.log('   - Обновлен индекс для phone (только для не-NULL значений)');
    
  } catch (error) {
    console.error('❌ Ошибка при применении исправлений:', error.message);
    
    // Проверяем, не применены ли уже исправления
    if (error.message.includes('constraint "patients_contact_check" of relation "patients" already exists')) {
      console.log('✅ Исправления уже были применены ранее');
    } else {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  fixDatabase();
}

module.exports = { fixDatabase };