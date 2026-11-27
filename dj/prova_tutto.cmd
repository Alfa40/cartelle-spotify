@echo off
cd /d C:\Users\proge\Desktop\Progetto.spotify\dj
set PY=.venv\Scripts\python.exe
%PY% dj.py analizza tutti || exit /b 1
for %%P in (sporca edit-dj remix-drill remix-trap remix-afrohouse remix-reggaeton remix-jerseyclub remix-techno remix-house) do %PY% dj.py fai %%P "let it in" || exit /b 1
for %%P in (sped-up slowed-reverb bassi) do %PY% dj.py fai %%P pompeii || exit /b 1
%PY% dj.py fai mashup anchor --con "let it in" || exit /b 1
