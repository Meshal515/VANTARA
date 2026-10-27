// Test-only IPC stand-in, NOT a decoder or proof of video playback. Real engine
// bytes are consumed and hashed by the parent benchmark over the desktop proxy.
// This file must never be bundled with the application.
import net from 'node:net';
const pipe=process.argv.slice(2).find(a=>a.startsWith('--input-ipc-server='))?.slice(19);
if(!pipe)throw new Error('Missing byte-test IPC pipe');
const values={'video-out-params':{w:1,h:1},'time-pos':0,duration:3600,pause:false,'paused-for-cache':false,'track-list':[]};
const server=net.createServer(socket=>{
  let buffer='';const send=m=>socket.write(JSON.stringify(m)+'\n');
  socket.on('data',b=>{buffer+=b;if(buffer.length>1024*1024){socket.destroy();return;}while(buffer.includes('\n')){
    const i=buffer.indexOf('\n'),m=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);
    const [command,name]=m.command;
    send({request_id:m.request_id,error:'success',data:command==='get_property'?values[name]:null});
    if(command==='observe_property')send({event:'property-change',name:m.command[2],data:values[m.command[2]]});
    if(command==='loadfile'){
      process.stdout.write(JSON.stringify({byteStreamURL:name})+'\n');
      send({event:'file-loaded'});send({event:'playback-restart'});
    }
  }});
});
server.listen(pipe);
process.on('SIGTERM',()=>{server.close();process.exit(0);});
