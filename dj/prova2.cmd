@echo off
cd /d C:\Users\proge\Desktop\Progetto.spotify\dj
set PY=.venv\Scripts\python.exe
for %%B in (relaxa sangue nunca chilled sublime) do %PY% dj.py analizza %%B || exit /b 1
for %%P in (sporca remix-drill remix-jerseyclub sped-up) do %PY% dj.py fai %%P relaxa || exit /b 1
for %%P in (remix-afrohouse remix-trap) do %PY% dj.py fai %%P sangue || exit /b 1
for %%P in (remix-reggaeton slowed-reverb bassi) do %PY% dj.py fai %%P nunca || exit /b 1
for %%P in (edit-dj remix-techno) do %PY% dj.py fai %%P chilled || exit /b 1
%PY% dj.py fai remix-house sublime || exit /b 1
%PY% dj.py fai mashup relaxa --con nunca || exit /b 1
%PY% dj.py fai mashup nunca --con chilled || exit /b 1
%PY% dj.py fai mashup sangue --con sublime || exit /b 1
