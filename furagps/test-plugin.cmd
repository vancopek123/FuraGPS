@echo off
setlocal
call "%~dp0Find-BuildTools.cmd"
if errorlevel 1 exit /b 1
cd /d "%~dp0"
if not exist build\test mkdir build\test
cl /nologo /LD /MT /EHsc /O2 /std:c++17 /DFURAGPS_UDP_PORT=28897 /I "..\scs-sdk\include" plugin\telemetry.cpp /Fo:build\test\telemetry.obj /link /DEF:plugin\telemetry.def /OUT:build\test\furagps-telemetry.dll
if errorlevel 1 exit /b 1
cl /nologo /MT /EHsc /std:c++17 /I "..\scs-sdk\include" tests\plugin-test.cpp /Fo:build\plugin-test.obj /Fe:build\plugin-test.exe
if errorlevel 1 exit /b 1
build\plugin-test.exe build\test\furagps-telemetry.dll %1
