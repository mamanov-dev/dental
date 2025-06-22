-- Файл: scripts/fix-duplicate-patients.sql
-- Миграция для исправления проблемы с дубликатами пациентов

BEGIN;

-- 1. Создаем временную функцию для нормализации телефонов
CREATE OR REPLACE FUNCTION normalize_phone(phone_input TEXT) 
RETURNS TEXT AS $$
BEGIN
    IF phone_input IS NULL THEN
        RETURN NULL;
    END IF;
    
    -- Удаляем все символы кроме цифр
    phone_input := REGEXP_REPLACE(phone_input, '[^0-9]', '', 'g');
    
    -- Если номер достаточной длины, добавляем +
    IF LENGTH(phone_input) >= 10 AND NOT phone_input LIKE '+%' THEN
        phone_input := '+' || phone_input;
    END IF;
    
    RETURN phone_input;
END;
$$ LANGUAGE plpgsql;

-- 2. Находим и сохраняем информацию о дубликатах
CREATE TEMP TABLE duplicate_patients AS
SELECT 
    chat_id,
    platform,
    COUNT(*) as duplicate_count,
    MIN(id) as keep_id,
    ARRAY_AGG(id ORDER BY created_at ASC) as all_ids
FROM patients
WHERE chat_id IS NOT NULL
GROUP BY chat_id, platform
HAVING COUNT(*) > 1;

-- 3. Логируем найденные дубликаты
DO $$
DECLARE
    dup_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO dup_count FROM duplicate_patients;
    RAISE NOTICE 'Найдено % групп дубликатов', dup_count;
END $$;

-- 4. Переносим все данные из дубликатов в основную запись
UPDATE patients p
SET 
    phone = COALESCE(p.phone, dup.phone),
    name = COALESCE(p.name, dup.name),
    last_activity = GREATEST(p.last_activity, dup.last_activity),
    updated_at = NOW()
FROM (
    SELECT 
        dp.keep_id,
        MAX(p2.phone) as phone,
        MAX(p2.name) as name,
        MAX(p2.last_activity) as last_activity
    FROM duplicate_patients dp
    JOIN patients p2 ON p2.id = ANY(dp.all_ids) AND p2.id != dp.keep_id
    GROUP BY dp.keep_id
) dup
WHERE p.id = dup.keep_id;

-- 5. Обновляем все связанные записи
-- Обновляем chat_sessions
UPDATE chat_sessions cs
SET patient_id = dp.keep_id
FROM duplicate_patients dp
WHERE cs.patient_id = ANY(dp.all_ids) 
AND cs.patient_id != dp.keep_id;

-- Обновляем appointments
UPDATE appointments a
SET patient_id = dp.keep_id
FROM duplicate_patients dp
WHERE a.patient_id = ANY(dp.all_ids) 
AND a.patient_id != dp.keep_id;

-- 6. Удаляем дубликаты, оставляя только основные записи
DELETE FROM patients
WHERE id IN (
    SELECT unnest(all_ids)
    FROM duplicate_patients
    WHERE id != ALL(ARRAY[keep_id])
);

-- 7. Нормализуем все телефоны и chat_id
UPDATE patients 
SET 
    phone = normalize_phone(phone),
    chat_id = CASE 
        WHEN platform = 'whatsapp' THEN normalize_phone(chat_id)
        ELSE chat_id
    END,
    updated_at = NOW()
WHERE phone IS NOT NULL OR (platform = 'whatsapp' AND chat_id IS NOT NULL);

-- 8. Пересоздаем уникальный индекс с правильным условием
DROP INDEX IF EXISTS idx_patients_chat_platform;
CREATE UNIQUE INDEX idx_patients_chat_platform 
ON patients(chat_id, platform) 
WHERE chat_id IS NOT NULL;

-- 9. Добавляем дополнительный индекс для поиска по телефону
DROP INDEX IF EXISTS idx_patients_phone_unique;
CREATE UNIQUE INDEX idx_patients_phone_unique 
ON patients(phone) 
WHERE phone IS NOT NULL;

-- 10. Логируем результат
DO $$
DECLARE
    total_patients INTEGER;
    with_phone INTEGER;
    with_chat_id INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_patients FROM patients;
    SELECT COUNT(*) INTO with_phone FROM patients WHERE phone IS NOT NULL;
    SELECT COUNT(*) INTO with_chat_id FROM patients WHERE chat_id IS NOT NULL;
    
    RAISE NOTICE 'Миграция завершена:';
    RAISE NOTICE '  Всего пациентов: %', total_patients;
    RAISE NOTICE '  С телефоном: %', with_phone;
    RAISE NOTICE '  С chat_id: %', with_chat_id;
END $$;

-- 11. Удаляем временную функцию
DROP FUNCTION IF EXISTS normalize_phone(TEXT);

COMMIT;

-- Проверка результатов
SELECT 
    'Дубликаты по chat_id и platform' as check_type,
    COUNT(*) as count
FROM (
    SELECT chat_id, platform, COUNT(*) as cnt
    FROM patients
    WHERE chat_id IS NOT NULL
    GROUP BY chat_id, platform
    HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 
    'Дубликаты по phone' as check_type,
    COUNT(*) as count
FROM (
    SELECT phone, COUNT(*) as cnt
    FROM patients
    WHERE phone IS NOT NULL
    GROUP BY phone
    HAVING COUNT(*) > 1
) t;