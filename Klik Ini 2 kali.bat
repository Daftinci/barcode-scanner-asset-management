@echo off
setlocal
cd /d "%~dp0"

set PORT=8000

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    set PYCMD=python
    goto :run
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    set PYCMD=py
    goto :run
)

echo.
echo Python was not found on this computer.
echo Install it from https://www.python.org/downloads/ and make sure to check
echo "Add python.exe to PATH" during setup, then run this file again.
echo.
pause
exit /b 1

:run
start "" "http://localhost:%PORT%"
%PYCMD% server.py %PORT%
