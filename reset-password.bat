@echo off
cd /d "%~dp0"
echo Close the journal window first, then answer below.
set /p U=Username: 
set /p P=New password (8+ characters): 
node reset-password.js %U% %P%
pause
