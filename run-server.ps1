$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$port = 8000
Start-Process "http://localhost:$port"
python server.py $port
