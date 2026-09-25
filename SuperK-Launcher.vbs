Option Explicit
Dim WshShell, FSO, scriptDir, uvicornExe, fCache
Dim isFrontendRunning, isBackendRunning, attempts, maxAttempts, url, browserExe

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(FSO.GetAbsolutePathName(WScript.ScriptFullName))

' 1. Cache setup if drive F:\ exists
If FSO.FolderExists("F:\") Then
    fCache = "F:\manga-cache"
    If Not FSO.FolderExists(fCache & "\ocr-jobs") Then FSO.CreateFolder(fCache & "\ocr-jobs")
    If Not FSO.FolderExists(fCache & "\paddle") Then FSO.CreateFolder(fCache & "\paddle")
    If Not FSO.FolderExists(fCache & "\torch") Then FSO.CreateFolder(fCache & "\torch")
    If Not FSO.FolderExists(fCache & "\huggingface") Then FSO.CreateFolder(fCache & "\huggingface")
    If Not FSO.FolderExists(fCache & "\temp") Then FSO.CreateFolder(fCache & "\temp")
    
    WshShell.Environment("PROCESS")("SUPERK_CACHE_DIR") = fCache & "\ocr-jobs"
    WshShell.Environment("PROCESS")("PADDLE_HOME") = fCache & "\paddle"
    WshShell.Environment("PROCESS")("TORCH_HOME") = fCache & "\torch"
    WshShell.Environment("PROCESS")("HF_HOME") = fCache & "\huggingface"
    WshShell.Environment("PROCESS")("TEMP") = fCache & "\temp"
End If

' 2. Locate uvicorn.exe
uvicornExe = scriptDir & "\ocr-service\venv\Scripts\uvicorn.exe"
If Not FSO.FileExists(uvicornExe) Then
    uvicornExe = scriptDir & "\ocr-service\.venv\Scripts\uvicorn.exe"
End If

' 3. Robust helper to check URL health
Function CheckUrl(testUrl)
    CheckUrl = False
    On Error Resume Next
    Dim xmlHttp, errNum, status
    Set xmlHttp = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    xmlHttp.setTimeouts 800, 800, 800, 800
    xmlHttp.Open "GET", testUrl, False
    xmlHttp.Send
    errNum = Err.Number
    If errNum = 0 Then
        status = xmlHttp.Status
        If status < 400 Then
            CheckUrl = True
        End If
    End If
    Set xmlHttp = Nothing
    On Error GoTo 0
End Function

' 4. Subroutine to spawn detached background process with zero window popup (SW_HIDE = 0)
Sub StartHiddenProcess(cmdLine, workDir)
    On Error Resume Next
    Dim objWMIService, objStartup, objConfig, objProcess, intPID
    Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
    Set objStartup = objWMIService.Get("Win32_ProcessStartup")
    Set objConfig = objStartup.SpawnInstance_
    objConfig.ShowWindow = 0
    Set objProcess = objWMIService.Get("Win32_Process")
    objProcess.Create cmdLine, workDir, objConfig, intPID
    Set objProcess = Nothing
    Set objConfig = Nothing
    Set objStartup = Nothing
    Set objWMIService = Nothing
    On Error GoTo 0
End Sub

isFrontendRunning = CheckUrl("http://127.0.0.1:3000")
isBackendRunning = CheckUrl("http://127.0.0.1:8765/health")

' 5. Start missing services silently in background via WMI
If Not isBackendRunning Then
    StartHiddenProcess "cmd.exe /c cd /d """ & scriptDir & "\ocr-service"" && """ & uvicornExe & """ app.api:app --host 127.0.0.1 --port 8765", scriptDir & "\ocr-service"
End If

If Not isFrontendRunning Then
    StartHiddenProcess "cmd.exe /c cd /d """ & scriptDir & """ && npm run dev", scriptDir
End If

' 6. Wait for frontend to be ready if it was started
If Not isFrontendRunning Then
    attempts = 0
    maxAttempts = 35
    Do While attempts < maxAttempts
        WScript.Sleep 1000
        If CheckUrl("http://127.0.0.1:3000") Then
            Exit Do
        End If
        attempts = attempts + 1
    Loop
End If

' 7. Open in Default Browser Tab (Standard mode - fast, lightweight, and uses existing browser instance)
url = "http://127.0.0.1:3000"
WshShell.Run "cmd.exe /c start " & url, 0, False
