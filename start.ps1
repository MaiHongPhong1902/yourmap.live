# Khởi động backend trên Windows (PowerShell).
Set-Location $PSScriptRoot

if (-not (Test-Path node_modules)) {
    Write-Host "Đang cài dependencies…"
    npm install --omit=dev
}

if (-not $env:PORT) { $env:PORT = "3000" }
if (-not $env:HOST) { $env:HOST = "0.0.0.0" }
Write-Host "Khởi động Map-Share tại http://$($env:HOST):$($env:PORT)"
node server.js
