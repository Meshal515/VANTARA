import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectMp4Index} from './mp4-bootstrap.mjs';
const atom=(type,size)=>{const b=Buffer.alloc(16);if(size>0xffffffff){b.writeUInt32BE(1);b.writeBigUInt64BE(BigInt(size),8);}else b.writeUInt32BE(size);b.write(type,4);return b;};
function source(entries){const reads=[];return {reads,read:async(at,length)=>{reads.push([at,length]);return entries.get(at)??Buffer.alloc(length);}};}
test('late MP4 metadata gets its exact post-mdat offset without waiting for the first verified piece',async()=>{
 const end=26*1024**3,s=source(new Map([[0,atom('ftyp',24)],[24,atom('mdat',end-24)]]));
 assert.deepEqual(await inspectMp4Index(s.read,end+3*1024**2,4*1024**2),{state:'index',offset:end});
 assert.ok(s.reads.length<=16);assert.ok(s.reads.every(([,n])=>n<=16));
});
test('a legal padding atom is skipped rather than downloading hundreds of MiB before the index',async()=>{
 const end=256*1024**2,s=source(new Map([[0,atom('ftyp',24)],[24,atom('mdat',100000-24)],[100000,atom('free',end-100000)]]));
 assert.deepEqual(await inspectMp4Index(s.read,end+20000,4*1024**2),{state:'index',offset:end});
});
test('faststart MP4 and non-MP4 containers request no tail',async()=>{
 for(const entries of [new Map([[0,atom('ftyp',24)],[24,atom('moov',200)]]),new Map([[0,Buffer.from('not an MP4 header')]])])assert.deepEqual(await inspectMp4Index(source(entries).read,100000,4096),{state:'none'});
});
test('incomplete sparse headers wait; malformed sizes and end-extending media do not trigger requests',async()=>{
 assert.deepEqual(await inspectMp4Index(source(new Map()).read,100000,4096),{state:'wait'});
 assert.deepEqual(await inspectMp4Index(source(new Map([[0,atom('ftyp',24)],[24,atom('mdat',100)]] )).read,100000,4096),{state:'index',offset:99999});
 for(const next of [atom('mdat',0),atom('mdat',4),atom('mdat',200000)])assert.deepEqual(await inspectMp4Index(source(new Map([[0,atom('ftyp',24)],[24,next]])).read,100000,4096),{state:'none'});
});
