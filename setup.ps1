# Cith setup launcher (Windows).
# All logic lives in scripts/setup.ts; this file only locates node and forwards args.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts as ANSI.
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Install Node.js 24 or newer: https://nodejs.org" -ForegroundColor Red
    exit 1
}

& node (Join-Path $root "scripts/setup.ts") @args
exit $LASTEXITCODE