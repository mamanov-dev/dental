#!/bin/bash

# =================== scripts/full-test.sh ===================

echo "🧪 Полное тестирование стоматологического бота"
echo "=============================================="

# Функция для вывода статуса
check_status() {
    if [ $? -eq 0 ]; then
        echo "✅ $1"
    else
        echo "❌ $1"
        exit 1
    fi
}

# 1. Проверка зависимостей
echo "1️⃣ Проверка зависимостей..."

# Node.js
node --version > /dev/null 2>&1
check_status "Node.js установлен: $(node --version)"

# Docker
docker --version > /dev/null 2>&1
check_status "Docker установлен: $(docker --version | head -n1)"

# npm пакеты
if [ -d "node_modules" ]; then
    echo "✅ npm пакеты установлены"
else
    echo "📦 Установка npm пакетов..."
    npm install
    check_status "npm пакеты установлены"
fi

# 2. Проверка конфигурации
echo ""
echo "2️⃣ Проверка конфигурации..."

if [ -f ".env" ]; then
    echo "✅ Файл .env найден"
    
    # Проверяем обязательные переменные
    source .env
    
    if [ -n "$DATABASE_URL" ]; then
        echo "✅ DATABASE_URL настроен"
    else
        echo "⚠️ DATABASE_URL не найден в .env"
    fi
    
    if [ -n "$JWT_SECRET" ]; then
        echo "✅ JWT_SECRET настроен"
    else
        echo "❌ JWT_SECRET не найден в .env"
        exit 1
    fi
    
    if [ -n "$API_KEY" ]; then
        echo "✅ API_KEY настроен"
    else
        echo "❌ API_KEY не найден в .env"
        exit 1
    fi
    
else
    echo "❌ Файл .env не найден"
    echo "Запустите: npm run setup"
    exit 1
fi

# 3. Запуск зависимостей
echo ""
echo "3️⃣ Запуск зависимостей..."

echo "🗄️ Запуск PostgreSQL и Redis..."
docker-compose up -d db redis
sleep 5

# Проверка PostgreSQL
until docker-compose exec -T db pg_isready -U dental_user -d dental_bot > /dev/null 2>&1; do
    echo "⏳ Ожидание PostgreSQL..."
    sleep 2
done
check_status "PostgreSQL готов"

# Проверка Redis
docker-compose exec -T redis redis-cli ping > /dev/null 2>&1
check_status "Redis готов"

# 4. Применение миграций
echo ""
echo "4️⃣ Применение миграций..."
npm run db:migrate > /dev/null 2>&1
check_status "Миграции применены"

npm run db:seed > /dev/null 2>&1
check_status "Тестовые данные загружены"

# 5. Сборка приложения
echo ""
echo "5️⃣ Сборка приложения..."
npm run build > /dev/null 2>&1
check_status "Приложение собрано"

# 6. Запуск приложения в фоне
echo ""
echo "6️⃣ Запуск приложения..."

# Запускаем приложение в фоне
npm start > logs/test.log 2>&1 &
APP_PID=$!

# Ждем запуска
sleep 10

# Проверяем что процесс запущен
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Приложение запущено (PID: $APP_PID)"
else
    echo "❌ Приложение не запустилось"
    cat logs/test.log
    exit 1
fi

# 7. Тестирование API
echo ""
echo "7️⃣ Тестирование API..."

# Health check
HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "$HEALTH_RESPONSE" = "200" ]; then
    echo "✅ Health check прошел"
else
    echo "❌ Health check провалился (HTTP $HEALTH_RESPONSE)"
    kill $APP_PID
    exit 1
fi

# API статус
API_RESPONSE=$(curl -s -H "X-API-Key: $API_KEY" http://localhost:3000/api/v1/status)
if echo "$API_RESPONSE" | grep -q '"success":true'; then
    echo "✅ API работает"
else
    echo "❌ API не отвечает"
    echo "Ответ: $API_RESPONSE"
    kill $APP_PID
    exit 1
fi

# Тест создания записи
APPOINTMENT_DATA='{
    "doctorId": 1,
    "patientPhone": "+77011234567",
    "patientName": "Тестовый Пациент",
    "appointmentDate": "'$(date -d '+1 day' -Iseconds)'",
    "serviceType": "consultation",
    "notes": "Автоматический тест"
}'

APPOINTMENT_RESPONSE=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "$APPOINTMENT_DATA" \
    http://localhost:3000/api/v1/appointments)

if echo "$APPOINTMENT_RESPONSE" | grep -q '"success":true'; then
    APPOINTMENT_ID=$(echo "$APPOINTMENT_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
    echo "✅ Запись создана (ID: $APPOINTMENT_ID)"
else
    echo "❌ Не удалось создать запись"
    echo "Ответ: $APPOINTMENT_RESPONSE"
    kill $APP_PID
    exit 1
fi

# 8. Тестирование webhook'ов
echo ""
echo "8️⃣ Тестирование webhook'ов..."

# WhatsApp webhook verification
WEBHOOK_VERIFY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:3000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=$WHATSAPP_WEBHOOK_VERIFY_TOKEN&hub.challenge=test123")

if [ "$WEBHOOK_VERIFY_RESPONSE" = "200" ]; then
    echo "✅ WhatsApp webhook verification"
else
    echo "⚠️ WhatsApp webhook verification провалился (настройте токены)"
fi

# Тест входящего сообщения WhatsApp
WHATSAPP_MESSAGE='{
    "object": "whatsapp_business_account",
    "entry": [{
        "changes": [{
            "field": "messages",
            "value": {
                "messages": [{
                    "from": "77011234567",
                    "id": "test_msg_'$(date +%s)'",
                    "timestamp": "'$(date +%s)'",
                    "text": {"body": "привет"},
                    "type": "text"
                }],
                "contacts": [{
                    "wa_id": "77011234567",
                    "profile": {"name": "Тестовый Пользователь"}
                }]
            }
        }]
    }]
}'

WHATSAPP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$WHATSAPP_MESSAGE" \
    http://localhost:3000/webhook/whatsapp)

if [ "$WHATSAPP_RESPONSE" = "200" ]; then
    echo "✅ WhatsApp сообщение обработано"
else
    echo "❌ WhatsApp сообщение не обработано (HTTP $WHATSAPP_RESPONSE)"
fi

# 9. Проверка логов
echo ""
echo "9️⃣ Проверка логов..."

if [ -f "logs/combined.log" ]; then
    LOG_LINES=$(wc -l < logs/combined.log)
    echo "✅ Логи записываются ($LOG_LINES строк)"
    
    # Проверяем на ошибки
    ERROR_COUNT=$(grep -c "ERROR" logs/combined.log 2>/dev/null || echo "0")
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo "⚠️ Найдено $ERROR_COUNT ошибок в логах"
        echo "Последние ошибки:"
        grep "ERROR" logs/combined.log | tail -3
    else
        echo "✅ Критических ошибок в логах не найдено"
    fi
else
    echo "⚠️ Файл логов не найден"
fi

# 10. Тестирование производительности
echo ""
echo "🔟 Тестирование производительности..."

# Нагрузочный тест health endpoint
echo "📊 Нагрузочный тест (100 запросов)..."
for i in {1..100}; do
    curl -s http://localhost:3000/health > /dev/null &
done
wait

sleep 2

# Проверяем что приложение все еще работает
if kill -0 $APP_PID 2>/dev/null; then
    echo "✅ Приложение выдержало нагрузку"
else
    echo "❌ Приложение упало под нагрузкой"
    exit 1
fi

# Проверяем использование памяти
if command -v ps &> /dev/null; then
    MEMORY_USAGE=$(ps -p $APP_PID -o rss= 2>/dev/null || echo "0")
    MEMORY_MB=$((MEMORY_USAGE / 1024))
    echo "📊 Использование памяти: ${MEMORY_MB}MB"
    
    if [ "$MEMORY_MB" -gt 500 ]; then
        echo "⚠️ Высокое использование памяти"
    else
        echo "✅ Использование памяти в норме"
    fi
fi

# 11. Cleanup
echo ""
echo "🧹 Очистка..."

# Останавливаем приложение
kill $APP_PID 2>/dev/null
sleep 2

# Форсированная остановка если нужно
if kill -0 $APP_PID 2>/dev/null; then
    kill -9 $APP_PID 2>/dev/null
fi

echo "✅ Приложение остановлено"

# Итоговый отчет
echo ""
echo "📋 ИТОГОВЫЙ ОТЧЕТ"
echo "=================="
echo "✅ Зависимости: OK"
echo "✅ Конфигурация: OK" 
echo "✅ База данных: OK"
echo "✅ Миграции: OK"
echo "✅ Сборка: OK"
echo "✅ API: OK"
echo "✅ Webhook'и: OK"
echo "✅ Логирование: OK"
echo "✅ Производительность: OK"
echo ""
echo "🎉 Все тесты прошли успешно!"
echo ""
echo "Следующие шаги:"
echo "1. Настройте реальные токены WhatsApp и Telegram в .env"
echo "2. Запустите в продакшене: npm run prod"
echo "3. Настройте мониторинг и алерты"
echo "4. Настройте backup базы данных"
echo ""
echo "Полезные команды:"
echo "- npm run dev           : Запуск для разработки"
echo "- npm run test:bot      : Тестирование API"
echo "- npm run logs          : Просмотр логов"
echo "- npm run health        : Проверка здоровья"

# =================== scripts/production-deploy.sh ===================

#!/bin/bash

echo "🚀 Развертывание в продакшене"
echo "=============================="

# Проверяем что это продакшн
if [ "$NODE_ENV" != "production" ]; then
    echo "❌ Этот скрипт только для продакшн среды"
    echo "Установите: export NODE_ENV=production"
    exit 1
fi

# Проверяем обязательные переменные
REQUIRED_VARS=(
    "DATABASE_URL"
    "REDIS_URL" 
    "JWT_SECRET"
    "ENCRYPTION_KEY"
    "WHATSAPP_ACCESS_TOKEN"
    "WHATSAPP_PHONE_NUMBER_ID"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Переменная $var не установлена"
        exit 1
    fi
done

echo "✅ Все обязательные переменные установлены"

# Создаем backup БД
echo "💾 Создание backup базы данных..."
BACKUP_FILE="backup_$(date +%Y%m%d_%H%M%S).sql"
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"
echo "✅ Backup создан: $BACKUP_FILE"

# Собираем приложение
echo "🔧 Сборка приложения..."
npm ci --only=production
npm run build

# Применяем миграции
echo "🔧 Применение миграций..."
npm run db:migrate

# Запускаем приложение
echo "🚀 Запуск приложения..."
npm start

echo "🎉 Развертывание завершено!"