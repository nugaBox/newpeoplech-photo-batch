@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "BASE_DIR=%~dp0"
set "MD_FILE=c:\Users\churchCom\Downloads\공동체 앨범.md"

if not exist "%MD_FILE%" (
    echo [오류] 마크다운 파일을 찾을 수 없습니다:
    echo   %MD_FILE%
    echo.
    echo 사용법: create_album_folders.bat [마크다운파일경로]
    pause
    exit /b 1
)

if not "%~1"=="" set "MD_FILE=%~f1"

echo 공동체 앨범 폴더 생성
echo   기준 폴더: %BASE_DIR%
echo   목록 파일: %MD_FILE%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_album_folders.ps1" -BaseDir "%BASE_DIR%" -MarkdownFile "%MD_FILE%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if %EXIT_CODE% neq 0 (
    echo 작업이 실패했습니다.
) else (
    echo 작업이 완료되었습니다.
)

pause
exit /b %EXIT_CODE%
