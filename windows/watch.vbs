' TGTI AI Office: started by Windows Task Scheduler every minute (no window, no tray icon).
' Starts the office server only while Wallpaper Engine is running and the server is not running yet.
' The server itself exits when Wallpaper Engine is closed (OFFICE_WITH_WE=1).
Option Explicit
Dim sh, fs, wmi, dir, f, node
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='wallpaper64.exe' OR Name='wallpaper32.exe'").Count = 0 Then WScript.Quit
If wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%office-server.mjs%'").Count > 0 Then WScript.Quit
dir = fs.GetParentFolderName(WScript.ScriptFullName)
node = "node.exe"
If fs.FileExists(dir & "\node-path.txt") Then
  Set f = fs.OpenTextFile(dir & "\node-path.txt", 1, False, -1)
  node = Trim(f.ReadLine)
  f.Close
End If
sh.Environment("PROCESS")("OFFICE_WITH_WE") = "1"
sh.Environment("PROCESS")("OFFICE_VERSION_FILE") = dir & "\version.txt"
sh.CurrentDirectory = dir
sh.Run """" & node & """ """ & dir & "\office-server.mjs""", 0, False
