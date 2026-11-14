@echo off
REM Prueba HTTP real (LAB /cecchetto en cones-prod). Doble click.
REM Toma las claves del .env.local del repo (las mismas de la app). No pide nada ni las guarda en otro lado.
where python >nul 2>nul
if errorlevel 1 (
  echo No se encontro Python. Avisale a Claude para pasar la prueba a Node.
  pause
  exit /b 1
)
cd /d "%~dp0\..\..\.."
python "supabase\tests\pedidos-duplicados-bloqueo\prueba_http_supabase.py"
echo.
echo Listo. Mandale a Claude el archivo resultado_http_*.json que quedo en la raiz del repo.
pause
