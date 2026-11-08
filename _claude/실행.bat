@echo off
chcp 65001 >nul
echo [1/2] 소스 최신화 중...
call "%~dp01_pull.bat"
echo [2/2] 도구 설치 및 API 점검 중... (1~2분)
call "%~dp02_setup_and_test.bat"
echo 완료. 이 창을 닫아도 됩니다.
pause
