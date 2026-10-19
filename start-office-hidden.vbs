' Starts the AI Office server in the background without a console window.
' Needs Node.js (https://nodejs.org, LTS). If node is not in PATH yet, the usual install folders are tried.
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
folder = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = folder
node = "node"
For Each p In Array(sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe")
  If fs.FileExists(p) Then node = """" & p & """"
Next
On Error Resume Next
sh.Run node & " office-server.mjs", 0, False
If Err.Number <> 0 Then
  MsgBox "Node.js not found on this computer, so the AI Office server cannot start." & vbCrLf & vbCrLf & _
    "Install Node.js LTS from https://nodejs.org, then run start-office.cmd again.", vbExclamation, "TGTI AI Office"
End If
