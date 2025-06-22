// Файл: scripts/fix-duplicates.js
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

async function fixDuplicates() {
  // Используем правильное подключение в зависимости от окружения
  let connectionString = process.env.DATABASE_URL;
  
  // Если запускаем локально (не в Docker), меняем db на localhost
  if (connectionString && connectionString.includes('@db:') && !process.env.RUNNING_IN_DOCKER) {
    connectionString = connectionString.replace('@db:', '@localhost:');
    console.log('🔄 Используем localhost для подключения к БД');
  }
  
  const pool = new Pool({ connectionString });

  try {
    console.log('🔧 Запуск исправления дубликатов пациентов...\n');

    // Сначала проверяем текущее состояние
    console.log('📊 Текущее состояние базы данных:');
    
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_patients,
        COUNT(DISTINCT chat_id) as unique_chat_ids,
        COUNT(DISTINCT phone) as unique_phones,
        COUNT(*) FILTER (WHERE chat_id IS NOT NULL) as with_chat_id,
        COUNT(*) FILTER (WHERE phone IS NOT NULL) as with_phone
      FROM patients
    `);
    
    console.log(`  Всего пациентов: ${stats.rows[0].total_patients}`);
    console.log(`  Уникальных chat_id: ${stats.rows[0].unique_chat_ids}`);
    console.log(`  Уникальных телефонов: ${stats.rows[0].unique_phones}`);
    console.log(`  С chat_id: ${stats.rows[0].with_chat_id}`);
    console.log(`  С телефоном: ${stats.rows[0].with_phone}\n`);

    // Проверяем дубликаты
    const duplicates = await pool.query(`
      SELECT chat_id, platform, COUNT(*) as count
      FROM patients
      WHERE chat_id IS NOT NULL
      GROUP BY chat_id, platform
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);

    if (duplicates.rows.length === 0) {
      console.log('✅ Дубликатов не найдено!\n');
      
      // Проверяем конкретный проблемный номер
      const problemNumber = '+77783425825';
      const checkProblem = await pool.query(`
        SELECT id, phone, chat_id, platform, created_at
        FROM patients
        WHERE phone = $1 OR chat_id = $1
        ORDER BY created_at
      `, [problemNumber]);
      
      if (checkProblem.rows.length > 0) {
        console.log(`📱 Записи для номера ${problemNumber}:`);
        checkProblem.rows.forEach(row => {
          console.log(`  ID: ${row.id}, Phone: ${row.phone}, Chat: ${row.chat_id}, Platform: ${row.platform}`);
        });
      }
      
      await pool.end();
      return;
    }

    console.log(`⚠️  Найдено ${duplicates.rows.length} групп дубликатов:`);
    duplicates.rows.slice(0, 5).forEach(row => {
      console.log(`  ${row.chat_id} (${row.platform}): ${row.count} записей`);
    });
    
    if (duplicates.rows.length > 5) {
      console.log(`  ... и еще ${duplicates.rows.length - 5} групп\n`);
    } else {
      console.log('');
    }

    // Спрашиваем подтверждение
    console.log('❓ Хотите исправить дубликаты? (yes/no): ');
    
    // Для автоматического запуска в CI/CD
    if (process.env.AUTO_FIX === 'true') {
      console.log('AUTO_FIX=true, продолжаем автоматически...\n');
    } else {
      // В реальном приложении здесь был бы readline
      console.log('Для ручного запуска используйте: AUTO_FIX=true npm run fix:duplicates\n');
      await pool.end();
      return;
    }

    // Читаем и выполняем SQL миграцию
    const migrationPath = path.join(__dirname, 'fix-duplicate-patients.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('🚀 Выполняем миграцию...');
    await pool.query(migrationSQL);
    
    // Проверяем результат
    console.log('\n✅ Миграция завершена!\n');
    console.log('📊 Новое состояние базы данных:');
    
    const newStats = await pool.query(`
      SELECT 
        COUNT(*) as total_patients,
        COUNT(DISTINCT chat_id) as unique_chat_ids,
        COUNT(DISTINCT phone) as unique_phones
      FROM patients
    `);
    
    console.log(`  Всего пациентов: ${newStats.rows[0].total_patients}`);
    console.log(`  Уникальных chat_id: ${newStats.rows[0].unique_chat_ids}`);
    console.log(`  Уникальных телефонов: ${newStats.rows[0].unique_phones}\n`);
    
    // Финальная проверка дубликатов
    const finalCheck = await pool.query(`
      SELECT COUNT(*) as dup_count
      FROM (
        SELECT chat_id, platform
        FROM patients
        WHERE chat_id IS NOT NULL
        GROUP BY chat_id, platform
        HAVING COUNT(*) > 1
      ) t
    `);
    
    if (finalCheck.rows[0].dup_count === 0) {
      console.log('🎉 Все дубликаты успешно удалены!');
    } else {
      console.log('⚠️  Остались дубликаты:', finalCheck.rows[0].dup_count);
    }

  } catch (error) {
    console.error('❌ Ошибка при исправлении дубликатов:', error);
    console.error('\nДетали ошибки:', error.message);
    
    if (error.code === '23505') {
      console.log('\n💡 Подсказка: Ошибка уникальности. Возможно, нужно вручную проверить данные.');
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Запускаем если это основной модуль
if (require.main === module) {
  fixDuplicates().then(() => {
    console.log('\n✅ Скрипт завершен');
  }).catch(err => {
    console.error('\n❌ Критическая ошибка:', err);
    process.exit(1);
  });
}

module.exports = { fixDuplicates };