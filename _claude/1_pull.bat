@echo off
chcp 65001 >nul
set OUT=%~dp0
set REPO=C:\Users\churchCom\Documents\Develop\web-app-newpeoplech
set LOG=%OUT%1_pull.log
echo === %date% %time% === > "%LOG%"
cd /d "%REPO%"
echo --- before >> "%LOG%"
git log --oneline -1 >> "%LOG%" 2>&1
git status --short >> "%LOG%" 2>&1
git stash push -m "claude-before-pull" -- docs/api/bb-board-reg.md src/main/resources/props/globals-api.properties >> "%LOG%" 2>&1
git pull --ff-only >> "%LOG%" 2>&1
echo --- after >> "%LOG%"
git log --oneline -15 >> "%LOG%" 2>&1
git status --short >> "%LOG%" 2>&1
git stash list >> "%LOG%" 2>&1
git diff --stat d278dde HEAD >> "%LOG%" 2>&1
rmdir /s /q "%OUT%src" 2>nul
mkdir "%OUT%src"
for /r "%REPO%\src\main\java\com\comin\home\api" %%f in (*.java) do copy /y "%%f" "%OUT%src\" >nul
copy /y "%REPO%\src\main\resources\props\globals-api.properties" "%OUT%src\" >nul
copy /y "%REPO%\src\main\resources\sqlmap\mariadb\home\api\ApiSQL.xml" "%OUT%src\" >nul
copy /y "%REPO%\docs\api\bb-board-reg.md" "%OUT%src\" >nul
for %%f in ("%REPO%\docs\api\sql\*.sql") do copy /y "%%f" "%OUT%src\" >nul
echo --- copied >> "%LOG%"
dir /b "%OUT%src" >> "%LOG%"
echo --- env >> "%LOG%"
where node >> "%LOG%" 2>&1
node -v >> "%LOG%" 2>&1
where npm >> "%LOG%" 2>&1
node -e "const k=process.env.SIIRU_API_KEY;console.log('SIIRU_API_KEY', k?('set, length '+k.length):'NOT SET')" >> "%LOG%" 2>&1
echo DONE >> "%LOG%"
