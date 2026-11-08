@echo off
chcp 65001 >nul
set OUT=%~dp0
set LOG=%OUT%2_test.log
set TOOL=%LOCALAPPDATA%\church-photo-album
echo === %date% %time% === > "%LOG%"
if not exist "%TOOL%" mkdir "%TOOL%"
copy /y "%OUT%upload-album.js" "%TOOL%\upload-album.js" >nul
cd /d "%TOOL%"
if not exist package.json call npm init -y >nul 2>&1
echo --- npm install >> "%LOG%"
call npm install sharp heic-convert --no-fund --no-audit >> "%LOG%" 2>&1
node -e "require('sharp');require('heic-convert');console.log('deps ok')" >> "%LOG%" 2>&1
echo --- api-test >> "%LOG%"
node "%OUT%api-test.js" >> "%LOG%" 2>&1
echo --- dry-run >> "%LOG%"
node upload-album.js --dry-run --settle-min 0 >> "%LOG%" 2>&1
echo DONE >> "%LOG%"
