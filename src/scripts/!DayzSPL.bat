@echo off
title DayZ Single Player Launcher
set serverName=DayZ_SPL

:: Server Configuration
set SERVER_PORT=2302
set CONFIG_FILE=DayzSPL.cfg
set PROFILES_FOLDER=Profiles\DayzSPL

:: Mod Configuration (semicolon separated, no spaces)
set MOD_LIST=

:: Start the server with mods
start "" /b /min "DayZServer_x64.exe" ^
    -serverName=%serverName% ^
    -config=%CONFIG_FILE% ^
    -port=%SERVER_PORT% ^
    -profiles=%PROFILES_FOLDER% ^
    -freezecheck ^
    -mod=%MOD_LIST%

exit