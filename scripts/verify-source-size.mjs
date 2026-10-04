import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:4179,strictPort:true,watch:{ignored:['**/.scratch/**','**/.superpowers/**']}},resolve:{alias:{'@':process.cwd()}}});
await server.listen();
try{
  const child=spawn(require('electron'),['tests/browser/source-size-electron.cjs','http://127.0.0.1:4179/tests/browser/source-size.html'],{stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Source-size browser verification timed out'));},60000);
    child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('exit',code=>{clearTimeout(timeout);resolve(code??1);});
  });
}finally{await server.close();}
