// Execute the actual shipped policy in the bundled MPV Lua interpreter.
// This is a policy/dispatch contract, not video playback or a rendered-frame proof.
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {softwareRenderPolicyLua} from '../apps/desktop/src/mpv-render-policy.mjs';
const dir=await fs.mkdtemp(join(tmpdir(),'vantara-policy-check-'));
try{
  const script=join(dir,'contract.lua'),proof=join(dir,'proof');
  const harness=`
local quit = mp.commandv
local hook, applied, reported, errors, fail = nil, 0, 0, 0, false
local original = mp
mp = {
    enable_messages = function(level) assert(level == "warn") end,
    register_event = function(name, fn) assert(name == "log-message"); hook = fn end,
    command_native = function(args)
        assert(args[1] == "apply-profile" and args[2] == "fast")
        if fail then return nil, "expected failure" end
        applied = applied + 1
        return {}
    end,
    commandv = function(a,b,c) assert(a == "script-message" and b == "vantara-software-render" and c == "fast"); reported = reported + 1 end,
    msg = {error = function() errors = errors + 1 end},
}
local function policy()
${softwareRenderPolicyLua}
end
local function event(prefix,text) hook({prefix=prefix,text=text}) end
policy()
event("vo/gpu-next/d3d11", "Device Name: NVIDIA")
event("vo/gpu-next/d3d11", "Hardware video decoding failed")
event("other", "Using a software adapter")
event("vo/gpu-next/libplacebo", "Using a software adapter")
assert(applied == 0 and reported == 0, "Hardware renderer or unrelated warning changed quality")
event("vo/gpu-next/d3d11", "Using a software adapter\\n")
event("vo/gpu-next/d3d11", "Using a software adapter\\n")
assert(applied == 1 and reported == 1, "WARP profile not applied exactly once")
policy()
event("vo/gpu/d3d11", "Using a software adapter")
assert(applied == 2 and reported == 2, "Legacy GPU WARP not supported")
policy(); fail = true
event("vo/gpu-next/d3d11", "Using a software adapter")
assert(applied == 2 and reported == 2 and errors == 1, "Failed profile reported success")
fail = false
event("vo/gpu-next/d3d11", "Using a software adapter")
assert(applied == 3 and reported == 3, "Failed profile incorrectly disabled retry")
mp = original
local f=assert(io.open(${JSON.stringify(proof.replaceAll('\\','/'))},"w")); f:write("policy contract passed"); f:close()
quit("quit", "0")
`;
  await fs.writeFile(script,harness);
  await new Promise((r,j)=>execFile(process.argv[2],['--no-config','--idle=yes','--vo=null','--ao=null','--terminal=no',`--script=${script}`],{timeout:10000,windowsHide:true},e=>e?j(e):r()));
  if(await fs.readFile(proof,'utf8')!=='policy contract passed')throw new Error('Missing real Lua policy contract proof');
  console.log('MPV Lua policy passed: hardware preserved, WARP applied once, failure does not report success. Not video evidence.');
}finally{await fs.rm(dir,{recursive:true,force:true});}
