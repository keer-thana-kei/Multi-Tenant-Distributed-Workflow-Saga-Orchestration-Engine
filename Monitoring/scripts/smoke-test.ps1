# Monitoring smoke test — PowerShell (Windows)
# Run from the repo root after starting the monitoring server:
#   node monitoring/src/server.js
# Usage: pwsh monitoring/scripts/smoke-test.ps1

param(
    [string]$BaseUrl = "http://localhost:4000",
    [int]$WaitSeconds = 30
)

$ErrorActionPreference = "Stop"
$passed = 0
$failed = 0

function Pass([string]$msg) {
    Write-Host "[PASS] $msg" -ForegroundColor Green
    $script:passed++
}

function Fail([string]$msg) {
    Write-Host "[FAIL] $msg" -ForegroundColor Red
    $script:failed++
}

function WaitForEndpoint([string]$url, [int]$timeoutSec) {
    $start = Get-Date
    while ((Get-Date) - $start -lt [TimeSpan]::FromSeconds($timeoutSec)) {
        try {
            $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($r.StatusCode -lt 400) { return $true }
        } catch {}
        Start-Sleep -Seconds 2
    }
    return $false
}

Write-Host ""
Write-Host "=== Monitoring Smoke Test ===" -ForegroundColor Cyan
Write-Host "Target: $BaseUrl"
Write-Host ""

# ── Step 1: Wait for server to be ready ───────────────────────────────────
Write-Host "Waiting up to ${WaitSeconds}s for monitoring server..." -ForegroundColor Yellow
$ready = WaitForEndpoint "$BaseUrl/" $WaitSeconds
if (-not $ready) {
    Write-Host "[ERROR] Monitoring server did not become ready in ${WaitSeconds}s." -ForegroundColor Red
    Write-Host "        Start it with: node monitoring/src/server.js"
    exit 1
}
Pass "Server is reachable at $BaseUrl"

# ── Step 2: GET /health returns 200 ──────────────────────────────────────
try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing
    if ($r.StatusCode -eq 200) { Pass "GET /health → HTTP 200" }
    else { Fail "GET /health returned HTTP $($r.StatusCode)" }

    $body = $r.Content | ConvertFrom-Json
    if ($body.services -and $body.services.Count -gt 0) {
        Pass "/health response has 'services' array with $($body.services.Count) entries"
    } else {
        Fail "/health response missing 'services' array or it is empty"
    }
    if ($body.overall) { Pass "/health has 'overall' field: $($body.overall)" }
    else               { Fail "/health missing 'overall' field" }
} catch {
    Fail "GET /health threw: $_"
}

# ── Step 3: All services report a known status ────────────────────────────
try {
    $body = (Invoke-WebRequest -Uri "$BaseUrl/health" -UseBasicParsing).Content | ConvertFrom-Json
    $validStatuses = @("healthy","degraded","down")
    $badServices = $body.services | Where-Object { $_.status -notin $validStatuses }
    if ($badServices.Count -eq 0) {
        Pass "All services report a valid status (healthy/degraded/down)"
    } else {
        Fail "Unexpected service status values: $($badServices | ConvertTo-Json -Compress)"
    }
} catch {
    Fail "Service status validation threw: $_"
}

# ── Step 4: GET /metrics returns 200 with system data ────────────────────
try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/metrics" -UseBasicParsing
    if ($r.StatusCode -eq 200) { Pass "GET /metrics → HTTP 200" }
    else { Fail "GET /metrics returned HTTP $($r.StatusCode)" }

    $m = $r.Content | ConvertFrom-Json
    if ($m.system) { Pass "/metrics has 'system' field" }
    else           { Fail "/metrics missing 'system' field" }

    if ($m.system.cpu.usagePercent -ge 0) { Pass "/metrics cpu.usagePercent = $($m.system.cpu.usagePercent)%" }
    else                                   { Fail "/metrics cpu.usagePercent is invalid" }

    if ($m.system.memory.usagePercent -ge 0) { Pass "/metrics memory.usagePercent = $($m.system.memory.usagePercent)%" }
    else                                      { Fail "/metrics memory.usagePercent is invalid" }
} catch {
    Fail "GET /metrics threw: $_"
}

# ── Step 5: GET /alerts returns 200 ──────────────────────────────────────
try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/alerts" -UseBasicParsing
    if ($r.StatusCode -eq 200) { Pass "GET /alerts → HTTP 200" }
    else { Fail "GET /alerts returned HTTP $($r.StatusCode)" }

    $a = $r.Content | ConvertFrom-Json
    if ($null -ne $a.count) { Pass "/alerts has 'count' field: $($a.count)" }
    else { Fail "/alerts missing 'count' field" }
} catch {
    Fail "GET /alerts threw: $_"
}

# ── Step 6: GET /api/status returns combined payload ─────────────────────
try {
    $r = Invoke-WebRequest -Uri "$BaseUrl/api/status" -UseBasicParsing
    if ($r.StatusCode -eq 200) { Pass "GET /api/status → HTTP 200" }
    else { Fail "GET /api/status returned HTTP $($r.StatusCode)" }

    $s = $r.Content | ConvertFrom-Json
    if ($s.health -and $s.metrics) { Pass "/api/status has 'health' and 'metrics'" }
    else { Fail "/api/status missing 'health' or 'metrics'" }
    if ($s.overall)  { Pass "/api/status overall = $($s.overall)" }
    else             { Fail "/api/status missing 'overall'" }
} catch {
    Fail "GET /api/status threw: $_"
}

# ── Step 7: WebSocket connects and sends first message ────────────────────
Write-Host ""
Write-Host "--- WebSocket test ---" -ForegroundColor Yellow
$wsResult = $false
try {
    Add-Type -AssemblyName System.Net.WebSockets.Client
    $wsUri = [Uri]("ws://localhost:4000")
    $client = [System.Net.WebSockets.ClientWebSocket]::new()
    $cts = [System.Threading.CancellationTokenSource]::new(8000)
    $connectTask = $client.ConnectAsync($wsUri, $cts.Token)
    $connectTask.Wait(5000) | Out-Null

    if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
        $buf = [byte[]]::new(4096)
        $seg = [ArraySegment[byte]]::new($buf)
        $recvTask = $client.ReceiveAsync($seg, $cts.Token)
        $recvTask.Wait(6000) | Out-Null
        $result = $recvTask.Result
        $msg = [System.Text.Encoding]::UTF8.GetString($buf, 0, $result.Count)
        if ($msg.Length -gt 0) {
            Pass "WebSocket received first message ($($msg.Length) bytes)"
            $wsResult = $true
        } else {
            Fail "WebSocket connected but received empty message"
        }
        $client.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [System.Threading.CancellationToken]::None).Wait(2000) | Out-Null
    } else {
        Fail "WebSocket state is $($client.State) after connect attempt"
    }
} catch {
    Fail "WebSocket test threw: $_"
}

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
Write-Host "  Passed: $passed" -ForegroundColor Green
Write-Host "  Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })
Write-Host ""

if ($failed -gt 0) {
    Write-Host "SMOKE TEST FAILED" -ForegroundColor Red
    exit 1
} else {
    Write-Host "ALL SMOKE TESTS PASSED" -ForegroundColor Green
    exit 0
}
