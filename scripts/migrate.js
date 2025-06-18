const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('🔧 Применение миграций...');
    
    // Читаем SQL файл с миграциями
    const migrationPath = path.join(__dirname, 'create-tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Выполняем миграции
    await pool.query(migrationSQL);
    
    console.log('✅ Миграции успешно применены');
  } catch (error) {
    console.error('❌ Ошибка при применении миграций:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };