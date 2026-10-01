# Generates a self-signed cert.pem/key.pem for server.py's TLS support (see its module
# docstring). Required for the remote phone scanner to work on iOS/Safari, which refuses to
# expose navigator.mediaDevices.getUserMedia at all on a plain http:// origin.
#
# Usage: .\generate-cert.ps1 <server-lan-ip-or-hostname>
#   e.g. .\generate-cert.ps1 192.168.1.50

param(
    [Parameter(Mandatory = $true)]
    [string]$HostOrIp
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    Write-Error "openssl not found on PATH. Install Git for Windows (bundles OpenSSL: https://git-scm.com/download/win) or run 'winget install ShiningLight.OpenSSL', then re-run this script."
    exit 1
}

$parsedIp = $null
$isIp = [System.Net.IPAddress]::TryParse($HostOrIp, [ref]$parsedIp)
$san = if ($isIp) { "subjectAltName=IP:$HostOrIp" } else { "subjectAltName=DNS:$HostOrIp" }

& openssl req -x509 -nodes -newkey rsa:2048 -keyout key.pem -out cert.pem -days 825 -subj "/CN=$HostOrIp" -addext $san
if ($LASTEXITCODE -ne 0) { throw "openssl failed (exit $LASTEXITCODE)" }

Write-Output ""
Write-Output "Generated cert.pem and key.pem for '$HostOrIp' (valid 825 days)."
Write-Output "Restart server.py (or the container) — it auto-detects these files in this folder."
Write-Output "The phone's browser will show a one-time 'not private' certificate warning to tap"
Write-Output "through (Show Details -> visit this website) since it's self-signed. That's expected."
