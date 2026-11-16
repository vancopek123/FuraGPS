@echo off
where cl.exe >nul 2>nul
if not errorlevel 1 exit /b 0
set "FURAGPS_VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%FURAGPS_VSWHERE%" (
  echo Install Visual Studio Build Tools with Desktop development with C++. 1>&2
  exit /b 1
)
for /f "usebackq tokens=*" %%i in (`"%FURAGPS_VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "FURAGPS_VS=%%i"
if not defined FURAGPS_VS exit /b 1
call "%FURAGPS_VS%\VC\Auxiliary\Build\vcvars64.bat" >nul
exit /b %errorlevel%
