@echo off
set "DEFAULT_PATH=C:\DEV\WSB\BIN\NODE_NPM"
if "%~1"=="" (
    set "NPM_HOME_VAL=%DEFAULT_PATH%"
) else (
    set "NPM_HOME_VAL=%~1"
)

echo Setting NPM_HOME to %NPM_HOME_VAL%...
setx NPM_HOME "%NPM_HOME_VAL%"

:: Update current session variables
set "NPM_HOME=%NPM_HOME_VAL%"
set "PATH=%NPM_HOME%;%PATH%"

echo Environment variable NPM_HOME has been set successfully.
echo Please restart your terminal/command prompt to apply PATH changes globally.
