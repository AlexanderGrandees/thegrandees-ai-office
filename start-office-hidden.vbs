' Starts the AI Office server in the background without a console window.
Set sh = CreateObject("WScript.Shell")
folder = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = folder
sh.Run "node office-server.mjs", 0, False
