import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const server=await createServer({configFile:false,root:process.cwd(),server:{host:'127.0.0.1',port:4181,strictPort:true,watch:{ignored:['**/.scratch/**','**/.superpowers/**']}},resolve:{alias:{'@':process.cwd()}}});
await server.listen();
try{
  const child=spawn(require('electron'),['tests/browser/source-size-electron.cjs','http://127.0.0.1:4181/tests/browser/source-size-complex.html'],{stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill();reject(new Error('Complex source-size browser verification timed out'));},60000);
    child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('exit',code=>{clearTimeout(timeout);resolve(code??1);});
  });
}finally{await server.close();}
