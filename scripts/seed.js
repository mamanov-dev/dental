const { Pool } = require('pg');
require('dotenv').config();

async function seedDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    console.log('📊 Загрузка тестовых данных...');

    // Создаем тестовую клинику
    const clinicResult = await pool.query(`
      INSERT INTO clinics (name, phone, address, settings) 
      VALUES ($1, $2, $3, $4)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [
      'Стоматология "Белый зуб"',
      '+77012345678',
      'г. Алматы, ул. Абая, 123',
      JSON.stringify({
        workingHours: {
          monday: { start: '09:00', end: '18:00' },
          tuesday: { start: '09:00', end: '18:00' },
          wednesday: { start: '09:00', end: '18:00' },
          thursday: { start: '09:00', end: '18:00' },
          friday: { start: '09:00', end: '18:00' },
          saturday: { start: '10:00', end: '16:00' },
          sunday: null
        },
        appointmentDuration: 60,
        maxAdvanceBookingDays: 30,
        reminderSettings: {
          enabled: true,
          times: [
            { hours: 24, message: 'Напоминаем о вашей записи завтра' },
            { hours: 2, message: 'Через 2 часа у вас прием' }
          ],
          channels: ['whatsapp', 'telegram']
        },
        autoConfirmation: false,
        languages: ['ru', 'kz'],
        services: [
          { id: 'consultation', name: 'Консультация', duration: 30, price: 5000 },
          { id: 'cleaning', name: 'Профессиональная чистка', duration: 60, price: 15000 },
          { id: 'treatment', name: 'Лечение кариеса', duration: 90, price: 25000 },
          { id: 'prosthetics', name: 'Протезирование', duration: 120, price: 50000 }
        ]
      })
    ]);

    let clinicId;
    if (clinicResult.rows.length > 0) {
      clinicId = clinicResult.rows[0].id;
      console.log(`✅ Создана клиника с ID: ${clinicId}`);
    } else {
      // Клиника уже существует, получаем ID
      const existingClinic = await pool.query('SELECT id FROM clinics LIMIT 1');
      clinicId = existingClinic.rows[0].id;
      console.log(`✅ Используется существующая клиника с ID: ${clinicId}`);
    }

    // Создаем тестовых врачей
    const doctors = [
      {
        name: 'Доктор Иванов Петр Сергеевич',
        specialization: 'Терапевт',
        services: ['consultation', 'treatment', 'cleaning']
      },
      {
        name: 'Доктор Петрова Анна Николаевна', 
        specialization: 'Хирург',
        services: ['consultation', 'surgery']
      },
      {
        name: 'Доктор Сидоров Михаил Владимирович',
        specialization: 'Ортопед',
        services: ['consultation', 'prosthetics']
      }
    ];

    for (const doctor of doctors) {
      await pool.query(`
        INSERT INTO doctors (clinic_id, name, specialization, services, working_hours)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        clinicId,
        doctor.name,
        doctor.specialization,
        JSON.stringify(doctor.services),
        JSON.stringify({
          monday: { start: '09:00', end: '18:00' },
          tuesday: { start: '09:00', end: '18:00' },
          wednesday: { start: '09:00', end: '18:00' },
          thursday: { start: '09:00', end: '18:00' },
          friday: { start: '09:00', end: '18:00' }
        })
      ]);
    }

    console.log('✅ Созданы тестовые врачи');

    // Создаем тестового пациента
    await pool.query(`
      INSERT INTO patients (phone, name, preferred_language, platform)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (phone) DO NOTHING
    `, ['+77011234567', 'Тестовый Пациент', 'ru', 'whatsapp']);

    console.log('✅ Создан тестовый пациент');

    console.log('🎉 Тестовые данные успешно загружены!');
    
  } catch (error) {
    console.error('❌ Ошибка при загрузке тестовых данных:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
