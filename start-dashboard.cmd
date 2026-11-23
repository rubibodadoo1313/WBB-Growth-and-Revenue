@echo off
rem Starts the Growth & Revenue dashboard. Double-click this file.
rem Keep the window open while you use the site - closing it stops the server.

cd /d "%~dp0site"

echo.
echo   Growth ^& Revenue dashboard
echo   ---------------------------------------
echo   Opening http://localhost:5178
echo.
echo   Keep this window OPEN while presenting.
echo   Press Ctrl+C or close it to stop.
echo.

start "" http://localhost:5178
python -m http.server 5178

echo.
echo   Server stopped.
pause
