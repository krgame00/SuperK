Option Explicit
Dim WshShell, FSO, scriptDir, uvicornExe, fCache
Dim isFrontendRunning, isBackendRunning, attempts, maxAttempts, url, browserPath

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)

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

' 3. Helper to check URL health
Function CheckUrl(testUrl)
    On Error Resume Next
    Dim xmlHttp
    Set xmlHttp = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    xmlHttp.setTimeouts 800, 800, 800, 800
    xmlHttp.Open "GET", testUrl, False
    xmlHttp.Send
    If Err.Number = 0 And xmlHttp.Status < 400 Then
        CheckUrl = True
    Else
        CheckUrl = False
    End If
    Set xmlHttp = Nothing
    On Error GoTo 0
End Function

isFrontendRunning = CheckUrl("http://127.0.0.1:3000")
isBackendRunning = CheckUrl("http://127.0.0.1:8765/health")

' 4. Start missing services silently
If Not isBackendRunning Then
    WshShell.CurrentDirectory = scriptDir & "\ocr-service"
    WshShell.Run """" & uvicornExe & """ app.api:app --host 127.0.0.1 --port 8765", 0, False
End If

If Not isFrontendRunning Then
    WshShell.CurrentDirectory = scriptDir
    WshShell.Run "cmd.exe /c npm run dev", 0, False
End If

' 5. Wait for frontend to be ready if it was started
If Not isFrontendRunning Then
    attempts = 0
    maxAttempts = 30
    Do While attempts < maxAttempts
        WScript.Sleep 1000
        If CheckUrl("http://127.0.0.1:3000") Then
            Exit Do
        End If
        attempts = attempts + 1
    Loop
End If

' 6. Detect Chromium browser for app mode
url = "http://127.0.0.1:3000"
browserPath = ""

Dim candidates, cPath
candidates = Array( _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe", _
    WshShell.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe", _
    WshShell.ExpandEnvironmentStrings("%ProgramFiles%") & "\BraveSoftware\Brave-Browser\Application\brave.exe", _
    WshShell.ExpandEnvironmentStrings("%LocalAppData%") & "\BraveSoftware\Brave-Browser\Application\brave.exe" _
)

For Each cPath In candidates
    If FSO.FileExists(cPath) Then
        browserPath = cPath
        Exit For
    End If
Next

If browserPath <> "" Then
    WshShell.Run """" & browserPath & """ --app=" & url, 1, False
Else
    WshShell.Run "cmd.exe /c start " & url, 0, False
End If
