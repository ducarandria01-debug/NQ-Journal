@echo off
chcp 65001 >nul
title NQ Journal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 journal.py
  goto fin
)
where python >nul 2>nul
if %errorlevel%==0 (
  python journal.py
  goto fin
)
echo.
echo Python 3 nest pas installe sur cet ordinateur.
echo Installe-le depuis https://www.python.org/downloads/ (coche "Add python.exe to PATH"), puis relance ce fichier.
echo.
:fin
pause
