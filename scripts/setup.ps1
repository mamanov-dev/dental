Write-Host "🚀 Настройка проекта стоматологического бота на Windows..." -ForegroundColor Green

# Проверяем наличие Node.js
try {
    $nodeVersion = node --version
    Write-Host "✅ Node.js установлен: $nodeVersion" -ForegroundColor Green
    
    # Проверяем версию
    $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($versionNumber -lt 18) {
        Write-Host "❌ Требуется Node.js версии 18 или выше. Текущая версия: $nodeVersion" -ForegroundColor Red
        Write-Host "Скачайте с https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "❌ Node.js не установлен. Скачайте с https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# Проверяем наличие Docker Desktop
try {
    $dockerVersion = docker --version
    Write-Host "✅ Docker установлен: $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker не установлен. Скачайте Docker Desktop с https://www.docker.com/products/docker-desktop/" -ForegroundColor Red
    exit 1
}

# Проверяем что Docker Desktop запущен
try {
    docker ps | Out-Null
    Write-Host "✅ Docker Desktop запущен" -ForegroundColor Green
} catch {
    Write-Host "❌ Docker Desktop не запущен. Запустите Docker Desktop и попробуйте снова." -ForegroundColor Red
    exit 1
}

# Устанавливаем зависимости
Write-Host "📦 Установка зависимостей..." -ForegroundColor Cyan
npm install

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Ошибка при установке зависимостей" -ForegroundColor Red
    exit 1
}

# Создаем .env файл если его нет
if (-Not (Test-Path ".env")) {
    Write-Host "📝 Создание .env файла..." -ForegroundColor Cyan
    Copy-Item ".env.example" ".env"
    
    # Генерируем случайные ключи (используем .NET для генерации)
    Add-Type -AssemblyName System.Security
    
    $jwtSecret = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $encryptionKey = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    $apiKey = "dental-bot-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 16)
    $webhookToken = [System.Guid]::NewGuid().ToString("N").Substring(0, 16)
    
    # Обновляем .env файл
    (Get-Content ".env") -replace "your-super-secret-jwt-key", $jwtSecret -replace "your-32-byte-hex-encryption-key", $encryptionKey -replace "your-api-key", $apiKey -replace "your-webhook-verify-token", $webhookToken | Set-Content ".env"
    
    Write-Host "✅ Файл .env создан с безопасными ключами" -ForegroundColor Green
    Write-Host "⚠️  ВАЖНО: Добавьте ваши токены WhatsApp и Telegram в .env файл" -ForegroundColor Yellow
} else {
    Write-Host "✅ Файл .env уже существует" -ForegroundColor Green
}

# Создаем директории
if (-Not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" }
if (-Not (Test-Path "dist")) { New-Item -ItemType Directory -Path "dist" }

Write-Host "🗄️ Запуск базы данных..." -ForegroundColor Cyan
docker-compose up -d db redis

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Ошибка при запуске Docker контейнеров" -ForegroundColor Red
    exit 1
}

# Ждем пока база данных запустится
Write-Host "⏳ Ожидание запуска PostgreSQL..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# Проверяем подключение к базе данных
$maxAttempts = 30
$attempt = 0
do {
    $attempt++
    try {
        docker-compose exec -T db pg_isready -U dental_user -d dental_bot | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ База данных готова" -ForegroundColor Green
            break
        }
    } catch {}
    
    if ($attempt -ge $maxAttempts) {
        Write-Host "❌ Не удалось подключиться к базе данных" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "⏳ Ожидание готовности базы данных... (попытка $attempt/$maxAttempts)" -ForegroundColor Yellow
    Start-Sleep -Seconds 2
} while ($true)

# Запускаем миграции
Write-Host "🔧 Применение миграций..." -ForegroundColor Cyan
npm run db:migrate

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Ошибка при применении миграций" -ForegroundColor Red
    exit 1
}

# Загружаем тестовые данные
Write-Host "📊 Загрузка тестовых данных..." -ForegroundColor Cyan
npm run db:seed

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Ошибка при загрузке тестовых данных" -ForegroundColor Red
    exit 1
}

Write-Host "🎉 Настройка завершена!" -ForegroundColor Green
Write-Host ""
Write-Host "Следующие шаги:" -ForegroundColor Cyan
Write-Host "1. Настройте токены WhatsApp и Telegram в файле .env" -ForegroundColor White
Write-Host "2. Запустите проект: npm run dev" -ForegroundColor White
Write-Host "3. Откройте http://localhost:3000/health для проверки" -ForegroundColor White
Write-Host ""
Write-Host "Полезные команды:" -ForegroundColor Cyan
Write-Host "- npm run dev        : Запуск в режиме разработки" -ForegroundColor White
Write-Host "- npm run build      : Сборка для продакшена" -ForegroundColor White
Write-Host "- npm run test       : Запуск тестов" -ForegroundColor White
Write-Host "- .\scripts\test.ps1 : Полное тестирование" -ForegroundColor White