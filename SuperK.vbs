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

' 3. Start Backend OCR Service silently (WindowStyle = 0: Hidden)
WshShell.CurrentDirectory = scriptDir & "\ocr-service"
WshShell.Run """" & uvicornExe & """ app.api:app --host 127.0.0.1 --port 8765", 0, False

' 4. Start Frontend Next.js silently (WindowStyle = 0: Hidden)
WshShell.CurrentDirectory = scriptDir
WshShell.Run "cmd.exe /c npm run dev", 0, False

WScript.Sleep 3000
WshShell.Run "cmd.exe /c start http://127.0.0.1:3000", 0, False
