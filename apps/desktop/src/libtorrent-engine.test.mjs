import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {libtorrentCommand,isolatedPythonEnvironment} from './libtorrent-engine.mjs';

const options={python:resolve('native/python.exe'),script:resolve('native/server.py'),apiPort:9876,listenPort:9877,dir:resolve('fixture cache'),stateDir:resolve('fixture state')};
test('native sidecar uses an explicit isolated runtime with literal argument paths',()=>{
  const command=libtorrentCommand(options);
  assert.equal(command.executable,options.python);
  assert.deepEqual(command.args,['-I',options.script,'--api-port','9876','--listen-port','9877','--download-dir',options.dir,'--state-dir',options.stateDir]);
});
test('native sidecar cannot resolve Python or a script from the working directory',()=>{
  for(const field of ['python','script','dir','stateDir'])assert.throws(()=>libtorrentCommand({...options,[field]:'relative/path'}));
  assert.throws(()=>libtorrentCommand({...options,apiPort:9877}));
  assert.throws(()=>libtorrentCommand({...options,apiPort:0}));
  assert.throws(()=>libtorrentCommand({...options,script:options.script+'\0'}));
});
test('Python module injection environment is stripped without removing private IPC auth',()=>{
  assert.deepEqual(isolatedPythonEnvironment({PYTHONPATH:'/attacker',pythonhome:'/other',PYTHONSTARTUP:'/code',PATH:'/system',RQBIT_HTTP_BASIC_AUTH_USERPASS:'private'}),{PATH:'/system',RQBIT_HTTP_BASIC_AUTH_USERPASS:'private'});
});
