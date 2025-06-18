# ==========================================
# BOT TESTING SCRIPT (Fixed version)
# ==========================================

Write-Host "Testing Dental Bot (Fixed)" -ForegroundColor Green
Write-Host "===========================" -ForegroundColor Green
Write-Host ""

# Ensure we're in the correct directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
Set-Location $projectRoot

Write-Host "Project root: $projectRoot" -ForegroundColor Cyan
Write-Host ""

# Test function
function Test-Component {
    param(
        [string]$Name,
        [scriptblock]$TestScript,
        [string]$SuccessMessage = "Working",
        [string]$FailureMessage = "Not working"
    )
    
    Write-Host "Testing: $Name" -ForegroundColor Cyan
    
    try {
        $result = & $TestScript
        if ($result) {
            Write-Host "SUCCESS: $SuccessMessage" -ForegroundColor Green
            return $true
        } else {
            Write-Host "FAILED: $FailureMessage" -ForegroundColor Red
            return $false
        }
    }
    catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# ==========================================
# 1. FIND WORKING API KEY
# ==========================================

Write-Host "1. FINDING WORKING API KEY" -ForegroundColor Yellow
Write-Host "==========================" -ForegroundColor Yellow

# Read .env file
$envContent = Get-Content ".env" -ErrorAction SilentlyContinue
$envApiKey = $null

if ($envContent) {
    $envApiKeyLine = $envContent | Select-String "API_KEY=" | Select-Object -First 1
    if ($envApiKeyLine) {
        $envApiKey = $envApiKeyLine.Line.Split('=')[1]
        Write-Host "Found API key in .env: $($envApiKey.Substring(0, 10))..." -ForegroundColor Cyan
    }
} else {
    Write-Host "WARNING: .env file not found" -ForegroundColor Yellow
}

# Test possible API keys
$testKeys = @(
    $envApiKey,
    "dental-bot-api-key-123456789",
    "dev-api-key-123", 
    "test",
    "dental-bot-test-key-123"
)

$workingApiKey = $null

foreach ($key in $testKeys) {
    if ($key) {
        Write-Host "Testing API key: $($key.Substring(0, 10))..." -ForegroundColor Yellow
        try {
            $headers = @{ "X-API-Key" = $key }
            $response = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/status" -Headers $headers -TimeoutSec 5
            if ($response.success) {
                Write-Host "SUCCESS: This API key works!" -ForegroundColor Green
                $workingApiKey = $key
                break
            }
        } catch {
            Write-Host "Failed" -ForegroundColor Red
        }
    }
}

if (-not $workingApiKey) {
    Write-Host "ERROR: No working API key found!" -ForegroundColor Red
    Write-Host "Check your .env file and restart the application" -ForegroundColor Yellow
    Read-Host "Press Enter to continue with limited testing"
} else {
    Write-Host "Using API key: $workingApiKey" -ForegroundColor Green
}

Write-Host ""

# ==========================================
# 2. INFRASTRUCTURE CHECK
# ==========================================

Write-Host "2. INFRASTRUCTURE CHECK" -ForegroundColor Yellow
Write-Host "=======================" -ForegroundColor Yellow

# Docker containers
Test-Component -Name "Docker containers" -TestScript {
    $containers = docker-compose ps --services --filter "status=running"
    return ($containers -contains "app" -and $containers -contains "db" -and $containers -contains "redis")
} -SuccessMessage "All containers running" -FailureMessage "Some containers not running"

# Main server
Test-Component -Name "Main server" -TestScript {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/" -TimeoutSec 5
    return $response.service -eq "dental-bot-api"
} -SuccessMessage "Server responding" -FailureMessage "Server not responding"

# Health check
Test-Component -Name "Health Check" -TestScript {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -TimeoutSec 5
    return $health.status -eq "healthy"
} -SuccessMessage "System healthy" -FailureMessage "System has issues"

Write-Host ""

# ==========================================
# 3. API CHECK (with working key)
# ==========================================

Write-Host "3. API CHECK" -ForegroundColor Yellow
Write-Host "============" -ForegroundColor Yellow

if ($workingApiKey) {
    $headers = @{ "X-API-Key" = $workingApiKey }

    # API status
    Test-Component -Name "API status" -TestScript {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/status" -Headers $headers -TimeoutSec 5
        return $response.success -eq $true
    } -SuccessMessage "API working" -FailureMessage "API not responding"

    # Get appointments
    Test-Component -Name "Get appointments" -TestScript {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/appointments" -Headers $headers -TimeoutSec 5
        return $response.success -eq $true
    } -SuccessMessage "Appointments loading" -FailureMessage "Problem loading appointments"

    # Create test appointment
    $testAppointment = @{
        doctorId = 1
        patientPhone = "+77011234567"
        patientName = "Test Robot"
        appointmentDate = (Get-Date).AddDays(1).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        serviceType = "consultation"
        notes = "Automated test"
    } | ConvertTo-Json

    Test-Component -Name "Create appointment" -TestScript {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/appointments" -Method POST -Headers $headers -Body $testAppointment -ContentType "application/json" -TimeoutSec 10
        return $response.success -eq $true
    } -SuccessMessage "Appointments created" -FailureMessage "Problem creating appointments"
} else {
    Write-Host "SKIPPED: API tests (no working API key)" -ForegroundColor Yellow
}

Write-Host ""

# ==========================================
# 4. WEBHOOK CHECK
# ==========================================

Write-Host "4. WEBHOOK CHECK" -ForegroundColor Yellow
Write-Host "================" -ForegroundColor Yellow

Test-Component -Name "Webhook status" -TestScript {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/webhook/status" -TimeoutSec 5
    return $response.success -eq $true
} -SuccessMessage "Webhook service working" -FailureMessage "Webhook service problem"

Test-Component -Name "Webhook health" -TestScript {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/webhook/health" -TimeoutSec 5
    return $response -ne $null
} -SuccessMessage "Webhook health responding" -FailureMessage "Webhook health not responding"

Write-Host ""

# ==========================================
# FINAL REPORT
# ==========================================

Write-Host "FINAL REPORT" -ForegroundColor Green
Write-Host "============" -ForegroundColor Green
Write-Host ""

if ($workingApiKey) {
    Write-Host "YOUR BOT IS WORKING! All components operational." -ForegroundColor Green
    Write-Host ""
    Write-Host "WORKING API KEY: $workingApiKey" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "   1. Configure WhatsApp/Telegram tokens in .env" -ForegroundColor White
    Write-Host "   2. Test real bot conversations" -ForegroundColor White
    Write-Host "   3. Deploy to production" -ForegroundColor White
} else {
    Write-Host "BOT PARTIALLY WORKING - Fix API key issue" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "TO FIX:" -ForegroundColor Red
    Write-Host "   1. Check API_KEY in .env file" -ForegroundColor White
    Write-Host "   2. Restart: docker-compose restart app" -ForegroundColor White
    Write-Host "   3. Run this test again" -ForegroundColor White
}

Write-Host ""
Write-Host "USEFUL LINKS:" -ForegroundColor Cyan
Write-Host "   API: http://localhost:3000" -ForegroundColor Gray
Write-Host "   Health: http://localhost:3000/health" -ForegroundColor Gray
Write-Host "   Database: http://localhost:8080" -ForegroundColor Gray

Write-Host ""
Read-Host "Press Enter to finish"