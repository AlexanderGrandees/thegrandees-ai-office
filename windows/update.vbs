' TGTI AI Office: started by the office server when a new version is out.
' Runs update.ps1 as its own hidden process, so it keeps going when the installer stops the server.
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\update.ps1""", 0, False
