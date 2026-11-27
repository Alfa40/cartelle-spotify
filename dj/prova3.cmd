@echo off
cd /d C:\Users\proge\Desktop\Progetto.spotify\dj
set PY=.venv\Scripts\python.exe -W ignore
%PY% dj.py fai remix-afrohouse sangue || exit /b 1
%PY% dj.py fai remix-house relaxa || exit /b 1
%PY% dj.py fai remix-drill relaxa || exit /b 1
%PY% dj.py fai remix-reggaeton nunca || exit /b 1
%PY% dj.py fai remix-techno "let it in" || exit /b 1
%PY% dj.py fai remix-jerseyclub sangue || exit /b 1
