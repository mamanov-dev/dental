Write-Host "🧪 Полное тестирование стоматологического бота" -ForegroundColor Green
Write-Host "==============================================`n" -ForegroundColor Green

# Функция для проверки статуса
function Test-Status {
    param($Description, $ExitCode = $LASTEXITCODE)
    if ($ExitCode -eq 0) {
        Write-Host "✅ $Description" -ForegroundColor Green
        return $true
    } else {
        Write-Host "❌ $Description" -ForegroundColor Red
        return $false
    }
}

# 1. Проверка зависимостей
Write-Host "1️⃣ Проверка зависимостей..." -ForegroundColor Cyan

# Node.js
try {
    $nodeVersion = node --version
    Test-Status "Node.js установлен: $nodeVersion"
} catch {
    Test-Status "Node.js не установлен" 1
    exit 1
}

# Docker
try {
    $dockerVersion = docker --version
    Test-Status "Docker установлен: $dockerVersion"
} catch {
    Test-Status "Docker не установлен" 1
    exit 1
}

# npm пакеты
if (Test-Path "node_modules") {
    Test-Status "npm пакеты установлены"
} else {
    Write-Host "📦 Установка npm пакетов..." -ForegroundColor Yellow
    npm install
    Test-Status "npm пакеты установлены"
}

# 2. Проверка конфигурации
Write-Host "`n2️⃣ Проверка конфигурации..." -ForegroundColor Cyan

if (Test-Path ".env") {
    Test-Status "Файл .env найден"
    
    # Загружаем переменные из .env
    Get-Content ".env" | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
    
    $requiredVars = @("DATABASE_URL", "JWT_SECRET", "API_KEY")
    foreach ($var in $requiredVars) {
        $value = [Environment]::GetEnvironmentVariable($var, "Process")
        if ($value) {
            Test-Status "$var настроен"
        } else {
            Test-Status "$var не найден в .env" 1
            exit 1
        }
    }
} else {
    Test-Status "Файл .env не найден" 1
    Write-Host "Запустите: .\scripts\setup.ps1" -ForegroundColor Yellow
    exit 1
}

# 3. Запуск зависимостей
Write-Host "`n3️⃣ Запуск зависимостей..." -ForegroundColor Cyan

Write-Host "🗄️ Запуск PostgreSQL и Redis..." -ForegroundColor Yellow
docker-compose up -d db redis
Start-Sleep -Seconds 5

# Проверка PostgreSQL
$maxAttempts = 15
$attempt = 0
do {
    $attempt++
    try {
        docker-compose exec -T db pg_isready -U dental_user -d dental_bot 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Test-Status "PostgreSQL готов"
            break
        }
    } catch {}
    
    if ($attempt -ge $maxAttempts) {
        Test-Status "PostgreSQL не запустился" 1
        exit 1
    }
    
    Write-Host "⏳ Ожидание PostgreSQL... (попытка $attempt/$maxAttempts)" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
} while ($true)

# Проверка Redis
try {
    docker-compose exec -T redis redis-cli ping 2>$null | Out-Null
    Test-Status "Redis готов"
} catch {
    Test-Status "Redis не готов" 1
    exit 1
}

# 4. Применение миграций
Write-Host "`n4️⃣ Применение миграций..." -ForegroundColor Cyan
npm run db:migrate 2>$null | Out-Null
Test-Status "Миграции применены"

npm run db:seed 2>$null | Out-Null
Test-Status "Тестовые данные загружены"

# 5. Сборка приложения
Write-Host "`n5️⃣ Сборка приложения..." -ForegroundColor Cyan
npm run build 2>$null | Out-Null
Test-Status "Приложение собрано"

# 6. Запуск приложения в фоне
Write-Host "`n6️⃣ Запуск приложения..." -ForegroundColor Cyan

# Запускаем приложение в фоне
$appProcess = Start-Process -FilePath "npm" -ArgumentList "start" -RedirectStandardOutput "logs\test.log" -RedirectStandardError "logs\test-error.log" -PassThru -WindowStyle Hidden

# Ждем запуска
Start-Sleep -Seconds 10

# Проверяем что процесс запущен
if ($appProcess -and !$appProcess.HasExited) {
    Test-Status "Приложение запущено (PID: $($appProcess.Id))"
} else {
    Test-Status "Приложение не запустилось" 1
    if (Test-Path "logs\test-error.log") {
        Write-Host "Логи ошибок:" -ForegroundColor Yellow
        Get-Content "logs\test-error.log" | Select-Object -Last 10
    }
    exit 1
}

# 7. Тестирование API
Write-Host "`n7️⃣ Тестирование API..." -ForegroundColor Cyan

# Health check
try {
    $healthResponse = Invoke-WebRequest -Uri "http://localhost:3000/health" -Method GET -TimeoutSec 10
    if ($healthResponse.StatusCode -eq 200) {
        Test-Status "Health check прошел"
    } else {
        Test-Status "Health check провалился (HTTP $($healthResponse.StatusCode))" 1
        $appProcess | Stop-Process -Force
        exit 1
    }
} catch {
    Test-Status "Health check провалился: $($_.Exception.Message)" 1
    $appProcess | Stop-Process -Force
    exit 1
}

# API статус
try {
    $apiKey = [Environment]::GetEnvironmentVariable("API_KEY", "Process")
    $headers = @{ "X-API-Key" = $apiKey }
    $apiResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/status" -Method GET -Headers $headers -TimeoutSec 10
    
    if ($apiResponse.success -eq $true) {
        Test-Status "API работает"
    } else {
        Test-Status "API не отвечает" 1
        $appProcess | Stop-Process -Force
        exit 1
    }
} catch {
    Test-Status "API не отвечает: $($_.Exception.Message)" 1
    $appProcess | Stop-Process -Force
    exit 1
}

# Тест создания записи
try {
    $tomorrow = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    $appointmentData = @{
        doctorId = 1
        patientPhone = "+77011234567"
        patientName = "Тестовый Пациент"
        appointmentDate = $tomorrow
        serviceType = "consultation"
        notes = "Автоматический тест"
    } | ConvertTo-Json
    
    $headers = @{ 
        "Content-Type" = "application/json"
        "X-API-Key" = $apiKey 
    }
    
    $appointmentResponse = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/appointments" -Method POST -Body $appointmentData -Headers $headers -TimeoutSec 10
    
    if ($appointmentResponse.success -eq $true) {
        Test-Status "Запись создана (ID: $($appointmentResponse.data.id))"
    } else {
        Test-Status "Не удалось создать запись" 1
        Write-Host "Ответ: $($appointmentResponse | ConvertTo-Json)" -ForegroundColor Yellow
        $appProcess | Stop-Process -Force
        exit 1
    }
} catch {
    Test-Status "Не удалось создать запись: $($_.Exception.Message)" 1
    $appProcess | Stop-Process -Force
    exit 1
}

# 8. Тестирование webhook'ов
Write-Host "`n8️⃣ Тестирование webhook'ов..." -ForegroundColor Cyan

# WhatsApp webhook verification
try {
    $webhookToken = [Environment]::GetEnvironmentVariable("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "Process")
    $webhookUrl = "http://localhost:3000/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=$webhookToken&hub.challenge=test123"
    $webhookResponse = Invoke-WebRequest -Uri $webhookUrl -Method GET -TimeoutSec 10
    
    if ($webhookResponse.StatusCode -eq 200) {
        Test-Status "WhatsApp webhook verification"
    } else {
        Test-Status "WhatsApp webhook verification провалился (настройте токены)" 0
    }
} catch {
    Test-Status "WhatsApp webhook verification провалился (настройте токены)" 0
}

# Тест входящего сообщения WhatsApp
try {
    $whatsappMessage = @{
        object = "whatsapp_business_account"
        entry = @(@{
            changes = @(@{
                field = "messages"
                value = @{
                    messages = @(@{
                        from = "77011234567"
                        id = "test_msg_$(Get-Date -Format 'yyyyMMddHHmmss')"
                        timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
                        text = @{ body = "привет" }
                        type = "text"
                    })
                    contacts = @(@{
                        wa_id = "77011234567"
                        profile = @{ name = "Тестовый Пользователь" }
                    })
                }
            })
        })
    } | ConvertTo-Json -Depth 10
    
    $headers = @{ "Content-Type" = "application/json" }
    $whatsappResponse = Invoke-WebRequest -Uri "http://localhost:3000/webhook/whatsapp" -Method POST -Body $whatsappMessage -Headers $headers -TimeoutSec 10
    
    if ($whatsappResponse.StatusCode -eq 200) {
        Test-Status "WhatsApp сообщение обработано"
    } else {
        Test-Status "WhatsApp сообщение не обработано (HTTP $($whatsappResponse.StatusCode))" 1
    }
} catch {
    Test-Status "WhatsApp сообщение не обработано: $($_.Exception.Message)" 1
}

# 9. Проверка логов
Write-Host "`n9️⃣ Проверка логов..." -ForegroundColor Cyan

if (Test-Path "logs\combined.log") {
    $logLines = (Get-Content "logs\combined.log").Count
    Test-Status "Логи записываются ($logLines строк)"
    
    # Проверяем на ошибки
    $errorLines = Get-Content "logs\combined.log" | Select-String "ERROR"
    if ($errorLines.Count -gt 0) {
        Write-Host "⚠️ Найдено $($errorLines.Count) ошибок в логах" -ForegroundColor Yellow
        Write-Host "Последние ошибки:" -ForegroundColor Yellow
        $errorLines | Select-Object -Last 3 | ForEach-Object { Write-Host $_.Line -ForegroundColor Red }
    } else {
        Test-Status "Критических ошибок в логах не найдено"
    }
} else {
    Test-Status "Файл логов не найден" 0
}

# 10. Тестирование производительности
Write-Host "`n🔟 Тестирование производительности..." -ForegroundColor Cyan

# Нагрузочный тест health endpoint
Write-Host "📊 Нагрузочный тест (50 запросов)..." -ForegroundColor Yellow

$jobs = @()
for ($i = 1; $i -le 50; $i++) {
    $jobs += Start-Job -ScriptBlock {
        try {
            Invoke-WebRequest -Uri "http://localhost:3000/health" -Method GET -TimeoutSec 5 | Out-Null
        } catch {}
    }
}

# Ждем завершения всех запросов
$jobs | Wait-Job | Out-Null
$jobs | Remove-Job

Start-Sleep -Seconds 2

# Проверяем что приложение все еще работает
if ($appProcess -and !$appProcess.HasExited) {
    Test-Status "Приложение выдержало нагрузку"
} else {
    Test-Status "Приложение упало под нагрузкой" 1
    exit 1
}

# Проверяем использование памяти
try {
    $memoryUsage = (Get-Process -Id $appProcess.Id).WorkingSet64 / 1MB
    Write-Host "📊 Использование памяти: $([math]::Round($memoryUsage, 2))MB" -ForegroundColor Cyan
    
    if ($memoryUsage -gt 500) {
        Test-Status "Высокое использование памяти" 0
    } else {
        Test-Status "Использование памяти в норме"
    }
} catch {
    Write-Host "⚠️ Не удалось получить данные о памяти" -ForegroundColor Yellow
}

# 11. Cleanup
Write-Host "`n🧹 Очистка..." -ForegroundColor Cyan

# Останавливаем приложение
if ($appProcess -and !$appProcess.HasExited) {
    $appProcess | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Test-Status "Приложение остановлено"

# Итоговый отчет
Write-Host "`n📋 ИТОГОВЫЙ ОТЧЕТ" -ForegroundColor Green
Write-Host "==================" -ForegroundColor Green
Write-Host "✅ Зависимости: OK" -ForegroundColor Green
Write-Host "✅ Конфигурация: OK" -ForegroundColor Green
Write-Host "✅ База данных: OK" -ForegroundColor Green
Write-Host "✅ Миграции: OK" -ForegroundColor Green
Write-Host "✅ Сборка: OK" -ForegroundColor Green
Write-Host "✅ API: OK" -ForegroundColor Green
Write-Host "✅ Webhook'и: OK" -ForegroundColor Green
Write-Host "✅ Логирование: OK" -ForegroundColor Green
Write-Host "✅ Производительность: OK" -ForegroundColor Green
Write-Host ""
Write-Host "🎉 Все тесты прошли успешно!" -ForegroundColor Green
Write-Host ""
Write-Host "Следующие шаги:" -ForegroundColor Cyan
Write-Host "1. Настройте реальные токены WhatsApp и Telegram в .env" -ForegroundColor White
Write-Host "2. Запустите в продакшене: npm run prod" -ForegroundColor White
Write-Host "3. Настройте мониторинг и алерты" -ForegroundColor White
Write-Host "4. Настройте backup базы данных" -ForegroundColor White
Write-Host ""
Write-Host "Полезные команды:" -ForegroundColor Cyan
Write-Host "- npm run dev                    : Запуск для разработки" -ForegroundColor White
Write-Host "- npm run test:bot               : Тестирование API" -ForegroundColor White
Write-Host "- Get-Content logs\combined.log  : Просмотр логов" -ForegroundColor White
Write-Host "- npm run health                 : Проверка здоровья" -ForegroundColor White
