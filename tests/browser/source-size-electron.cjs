// eslint-disable-next-line @typescript-eslint/no-require-imports
const {app,BrowserWindow}=require('electron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs=require('node:fs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path=require('node:path');
app.setPath('userData', path.join(process.cwd(), '.scratch', 'source-size-electron-profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
  try{
    await window.loadURL(process.argv[2]);
    const result=await window.webContents.executeJavaScript('window.sourceSizeCheck');
    if(process.env.SOURCE_SIZE_OUTPUT)fs.writeFileSync(process.env.SOURCE_SIZE_OUTPUT,JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));app.exit(result.ok?0:1);
  }catch(error){console.error(error);app.exit(1);}
});
