@echo off
setlocal
call "%~dp0Find-BuildTools.cmd"
if errorlevel 1 exit /b 1
cd /d "%~dp0"
if not exist build mkdir build
cl /nologo /LD /MT /EHsc /O2 /std:c++17 /I "..\scs-sdk\include" plugin\telemetry.cpp /Fo:build\telemetry.obj /link /DEF:plugin\telemetry.def /OUT:build\furagps-telemetry.dll
exit /b %errorlevel%
