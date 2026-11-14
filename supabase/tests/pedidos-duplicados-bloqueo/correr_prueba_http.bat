@echo off
REM Prueba HTTP real (LAB /cecchetto en cones-prod). Doble click o: supabase\tests\pedidos-duplicados-bloqueo\correr_prueba_http.bat
REM Pide las dos claves en pantalla; viven solo en esta ventana y no se guardan en ningun archivo.
where python >nul 2>nul
if errorlevel 1 (
  echo No se encontro Python. Avisale a Claude para pasar la prueba a Node.
  pause
  exit /b 1
)
set /p SB_ANON_KEY=Pega la clave anon de cones-prod y Enter: 
set /p SB_SERVICE_ROLE_KEY=Pega la clave service_role de cones-prod y Enter: 
python "%~dp0prueba_http_supabase.py"
set SB_ANON_KEY=
set SB_SERVICE_ROLE_KEY=
echo.
echo Listo. Mandale a Claude el archivo resultado_http_*.json que quedo en esta carpeta.
pause
