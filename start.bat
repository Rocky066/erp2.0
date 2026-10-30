@echo off
title Garumara Jatiya Vidyalaya Server
echo =============================================================
echo   Garumara Jatiya Vidyalaya - School Management System
echo =============================================================
echo.
echo   Starting the background server using agy-node...
start "" agy-node server.js
echo.
echo   Waiting for server initialization (3 seconds)...
ping -n 4 127.0.0.1 >nul
echo.
echo   Opening Website and Admin Panel in your web browser...
start "" "http://localhost:3000"
echo.
echo   Done! Minimize this window to keep the server running.
echo   To stop the server, close this window and run:
echo   taskkill /f /im Antigravity.exe
echo.
pause
