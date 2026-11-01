Option Explicit
' SuperK launcher: delegates to the production pipeline (build-if-stale + start + health wait).
' For development use `npm run dev` in the repo root instead.
Dim shell, fso, root, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & root & "\scripts\start-production.ps1"" -ProjectRoot """ & root & """"
On Error Resume Next
shell.Run command, 0, False
If Err.Number <> 0 Then
    MsgBox "Could not start SuperK. Check PowerShell and the launcher files.", vbCritical, "SuperK"
End If
