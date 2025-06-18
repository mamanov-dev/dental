Write-Host "🚀 Автоматическая установка зависимостей для Windows" -ForegroundColor Green
Write-Host "====================================================`n" -ForegroundColor Green

# Проверяем права администратора
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

# Функция для установки через winget
function Install-WithWinget {
    param($Package, $Name)
    
    Write-Host "📦 Установка $Name через winget..." -ForegroundColor Cyan
    try {
        winget install $Package --accept-source-agreements --accept-package-agreements
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ $Name успешно установлен" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Ошибка при установке $Name" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ Ошибка при установке $Name: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Функция для установки через Chocolatey
function Install-WithChocolatey {
    param($Package, $Name)
    
    Write-Host "📦 Установка $Name через Chocolatey..." -ForegroundColor Cyan
    try {
        choco install $Package -y
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ $Name успешно установлен" -ForegroundColor Green
            return $true
        } else {
            Write-Host "❌ Ошибка при установке $Name" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "❌ Ошибка при установке $Name: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# 1. Проверяем и устанавливаем winget
Write-Host "1️⃣ Проверка менеджеров пакетов..." -ForegroundColor Cyan

$hasWinget = $false
$hasChoco = $false

try {
    winget --version | Out-Null
    $hasWinget = $true
    Write-Host "✅ winget доступен" -ForegroundColor Green
} catch {
    Write-Host "⚠️ winget не найден" -ForegroundColor Yellow
}

try {
    choco --version | Out-Null
    $hasChoco = $true
    Write-Host "✅ Chocolatey доступен" -ForegroundColor Green
} catch {
    Write-Host "⚠️ Chocolatey не найден" -ForegroundColor Yellow
}

if (-not $hasWinget -and -not $hasChoco) {
    Write-Host "❌ Не найдено ни одного менеджера пакетов" -ForegroundColor Red
    Write-Host "Установите winget (Windows Package Manager) или Chocolatey:" -ForegroundColor Yellow
    Write-Host "- winget: https://github.com/microsoft/winget-cli" -ForegroundColor White
    Write-Host "- Chocolatey: https://chocolatey.org/install" -ForegroundColor White
    exit 1
}

# 2. Устанавливаем Node.js
Write-Host "`n2️⃣ Проверка Node.js..." -ForegroundColor Cyan

try {
    $nodeVersion = node --version
    $versionNumber = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($versionNumber -ge 18) {
        Write-Host "✅ Node.js $nodeVersion уже установлен" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Node.js версии $nodeVersion устарел, требуется обновление" -ForegroundColor Yellow
        throw "Old version"
    }
} catch {
    Write-Host "📦 Установка Node.js 18..." -ForegroundColor Yellow
    
    $installed = $false
    if ($hasWinget) {
        $installed = Install-WithWinget "OpenJS.NodeJS" "Node.js"
    }
    
    if (-not $installed -and $hasChoco) {
        $installed = Install-WithChocolatey "nodejs" "Node.js"
    }
    
    if (-not $installed) {
        Write-Host "❌ Не удалось установить Node.js автоматически" -ForegroundColor Red
        Write-Host "Скачайте вручную: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
    
    # Обновляем PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    
    # Проверяем установку
    try {
        $nodeVersion = node --version
        Write-Host "✅ Node.js $nodeVersion успешно установлен" -ForegroundColor Green
    } catch {
        Write-Host "❌ Node.js не найден после установки. Перезапустите PowerShell." -ForegroundColor Red
        exit 1
    }
}

# 3. Устанавливаем Docker Desktop
Write-Host "`n3️⃣ Проверка Docker Desktop..." -ForegroundColor Cyan

try {
    docker --version | Out-Null
    Write-Host "✅ Docker уже установлен: $(docker --version)" -ForegroundColor Green
} catch {
    Write-Host "📦 Установка Docker Desktop..." -ForegroundColor Yellow
    
    $installed = $false
    if ($hasWinget) {
        $installed = Install-WithWinget "Docker.DockerDesktop" "Docker Desktop"
    }
    
    if (-not $installed -and $hasChoco) {
        $installed = Install-WithChocolatey "docker-desktop" "Docker Desktop"
    }
    
    if (-not $installed) {
        Write-Host "❌ Не удалось установить Docker Desktop автоматически" -ForegroundColor Red
        Write-Host "Скачайте вручную: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
        Write-Host "После установки Docker Desktop:" -ForegroundColor Yellow
        Write-Host "1. Запустите Docker Desktop" -ForegroundColor White
        Write-Host "2. Перезапустите PowerShell" -ForegroundColor White
        Write-Host "3. Запустите этот скрипт снова" -ForegroundColor White
        exit 1
    }
    
    Write-Host "⚠️ Docker Desktop установлен, но требуется:" -ForegroundColor Yellow
    Write-Host "1. Запустить Docker Desktop" -ForegroundColor White
    Write-Host "2. Перезапустить PowerShell" -ForegroundColor White
    Write-Host "3. Запустить .\scripts\setup.ps1" -ForegroundColor White
    exit 0
}

# 4. Устанавливаем Git (если не установлен)
Write-Host "`n4️⃣ Проверка Git..." -ForegroundColor Cyan

try {
    git --version | Out-Null
    Write-Host "✅ Git уже установлен: $(git --version)" -ForegroundColor Green
} catch {
    Write-Host "📦 Установка Git..." -ForegroundColor Yellow
    
    $installed = $false
    if ($hasWinget) {
        $installed = Install-WithWinget "Git.Git" "Git"
    }
    
    if (-not $installed -and $hasChoco) {
        $installed = Install-WithChocolatey "git" "Git"
    }
    
    if ($installed) {
        # Обновляем PATH
        $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
        Write-Host "✅ Git успешно установлен" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Git не удалось установить автоматически" -ForegroundColor Yellow
        Write-Host "Скачайте вручную: https://git-scm.com/" -ForegroundColor White
    }
}

# 5. Проверяем VS Code (опционально)
Write-Host "`n5️⃣ Проверка VS Code (опционально)..." -ForegroundColor Cyan

try {
    code --version | Out-Null
    Write-Host "✅ VS Code уже установлен" -ForegroundColor Green
} catch {
    Write-Host "💡 VS Code не найден. Хотите установить? (y/n): " -ForegroundColor Yellow -NoNewline
    $response = Read-Host
    
    if ($response -eq 'y' -or $response -eq 'Y') {
        $installed = $false
        if ($hasWinget) {
            $installed = Install-WithWinget "Microsoft.VisualStudioCode" "VS Code"
        }
        
        if (-not $installed -and $hasChoco) {
            $installed = Install-WithChocolatey "vscode" "VS Code"
        }
        
        if ($installed) {
            Write-Host "✅ VS Code успешно установлен" -ForegroundColor Green
        }
    }
}

Write-Host "`n🎉 Установка зависимостей завершена!" -ForegroundColor Green
Write-Host ""
Write-Host "Следующие шаги:" -ForegroundColor Cyan
Write-Host "1. Убедитесь что Docker Desktop запущен" -ForegroundColor White
Write-Host "2. Перезапустите PowerShell для обновления PATH" -ForegroundColor White
Write-Host "3. Запустите: .\scripts\setup.ps1" -ForegroundColor White
Write-Host ""
Write-Host "Если возникли проблемы:" -ForegroundColor Yellow
Write-Host "- Перезагрузите компьютер" -ForegroundColor White
Write-Host "- Запустите PowerShell от имени администратора" -ForegroundColor White
Write-Host "- Проверьте что все программы доступны: node --version, docker --version" -ForegroundColor White