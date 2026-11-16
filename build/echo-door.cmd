@echo off
rem Runs the echo-door command on the copy of Node that is inside Echo. Nothing else needs installing.
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0Echo.exe" "%~dp0resources\app.asar\dist\core\door-cli.js" %*
