@echo off
chcp 65001 >nul
set OUT=%~dp0
set LOG=%OUT%3_upload.log
set TOOL=%LOCALAPPDATA%\church-photo-album
echo === %date% %time% === > "%LOG%"
cd /d C:\Users\churchCom\Documents\Develop\web-app-newpeoplech
git stash list >> "%LOG%" 2>&1
git stash drop >> "%LOG%" 2>&1
git status --short >> "%LOG%" 2>&1
copy /y "%OUT%upload-album.js" "%TOOL%\upload-album.js" >nul
cd /d "%TOOL%"
echo [실제 업로드] 2026\20261018 여전도회 헌신예배 (13장) 등록 중...
node upload-album.js --only "20261018 여전도회 헌신예배" --settle-min 0 >> "%LOG%" 2>&1
echo DONE >> "%LOG%"
type "%LOG%"
pause
