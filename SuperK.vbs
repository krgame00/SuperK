Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

electronExe = scriptDir & "\node_modules\electron\dist\electron.exe"

If FSO.FileExists(electronExe) Then
    WshShell.Run """" & electronExe & """ .", 0, False
Else
    MsgBox "ไม่พบ Electron ใน node_modules กรุณารัน npm install ก่อน", 16, "SuperK Manga Translator"
End If
