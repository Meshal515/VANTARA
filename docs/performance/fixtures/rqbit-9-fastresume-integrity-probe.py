#!/usr/bin/env python3
"""Owned-data rqbit 9.0.1 fastresume integrity reproducer; localhost only.

Usage: python3 rqbit-9-fastresume-integrity-probe.py /absolute/path/to/rqbit
Requires Linux/Python 3 and an executable rqbit. Does not access any public swarm.
Leaves authored data, session state, and engine logs in a new temporary directory.
A passing assertion reproduces the upstream bug; it is not desired app behavior.
"""
import pathlib,tempfile,hashlib,socket,subprocess,http.client,json,time,sys,atexit,shutil
ROOT=pathlib.Path(tempfile.mkdtemp(prefix='vantara-fastresume-proof-'))
BINARY=shutil.which(sys.argv[1] if len(sys.argv)>1 else 'rqbit')
if not BINARY:
 raise SystemExit('Provide an executable rqbit path as the first argument')
CHILDREN=[]
@atexit.register
def cleanup_processes():
 for child in CHILDREN:
  if child.poll() is None:
   child.terminate()
   try:child.wait(3)
   except subprocess.TimeoutExpired:child.kill();child.wait()
def enc(x):
 if isinstance(x,bytes):return str(len(x)).encode()+b':'+x
 if isinstance(x,str):return enc(x.encode())
 if isinstance(x,int):return b'i'+str(x).encode()+b'e'
 return b'd'+b''.join(enc(k)+enc(x[k]) for k in sorted(x))+b'e'
def port():
 s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
def req(p,path,body=None,headers={},timeout=2):
 c=http.client.HTTPConnection('127.0.0.1',p,timeout=timeout);c.request('POST' if body is not None else 'GET',path,body=body,headers=headers);r=c.getresponse();data=r.read();c.close();return r.status,data
owned=b'VANTARA owned integrity fixture. '*400
info={'name':'owned.bin','length':len(owned),'piece length':16384,'pieces':hashlib.sha1(owned).digest()};torrent=enc({'info':info});hash_=hashlib.sha1(enc(info)).hexdigest()
(ROOT/'data').mkdir();(ROOT/'data'/'owned.bin').write_bytes(owned)

def launch(fast=True):
 p=port();log=(ROOT/('log-'+str(time.time_ns()))).open('wb');args=[BINARY,'-v','info','--http-api-listen-addr',f'127.0.0.1:{p}','--listen-ip','127.0.0.1','--listen-port',str(port()),'--disable-dht','--disable-trackers','--disable-lsd','--disable-upnp-port-forward','server','start',str(ROOT/'data'),'--persistence-location',str(ROOT/'state')]+(['--fastresume'] if fast else [])
 child=subprocess.Popen(args,stdout=log,stderr=log)
 CHILDREN.append(child)
 for _ in range(150):
  try:
   if req(p,'/')[0]==200:return child,p,log
  except Exception:pass
  time.sleep(.03)
 raise Exception('engine not ready')
def ready(p):
 for _ in range(100):
  d=json.loads(req(p,'/torrents/0/stats/v1')[1])
  if d['state'] in ['live','paused']:return d
  time.sleep(.03)
 raise Exception('not initialized')
def stop(child,p,log):
 try:req(p,'/torrents/0/pause',b'')
 except Exception:pass
 child.terminate()
 try:child.wait(3)
 except subprocess.TimeoutExpired:child.kill();child.wait()
 log.close()
child,p,log=launch();status,body=req(p,'/torrents?is_url=false&overwrite=true',torrent,{'Content-Type':'application/x-bittorrent'});assert status==200,(status,body)
a=ready(p);status,raw=req(p,'/torrents/0/metadata');assert raw==torrent
status,stream=req(p,'/torrents/0/stream/0',headers={'Range':'bytes=0-127'});assert stream==owned[:128]
stop(child,p,log)
assert (ROOT/'state'/f'{hash_}.bitv').exists()
corrupt=b'X'*len(owned);(ROOT/'data'/'owned.bin').write_bytes(corrupt)
child,p,log=launch();b=ready(p);status,stream=req(p,'/torrents/0/stream/0',headers={'Range':'bytes=0-127'});assert stream==corrupt[:128]
stop(child,p,log)
child,p,log=launch(False);c=ready(p)
try:req(p,'/torrents/0/stream/0',headers={'Range':'bytes=0-127'},timeout=.3);blocked=False
except (TimeoutError,socket.timeout):blocked=True
stop(child,p,log)
summary={'binary_version':subprocess.check_output([BINARY,'--version'],text=True).strip(),'fixture_bytes':len(owned),'piece_count':1,'initial_finished':a.get('finished'),'restart_fastresume_finished_after_same_length_corruption':b.get('finished'),'restart_fastresume_served_corrupted_range':stream==corrupt[:128],'restart_without_fastresume_finished':c.get('finished'),'restart_without_fastresume_range_blocked_no_peers':blocked,'binary_sha256':hashlib.sha256(pathlib.Path(BINARY).read_bytes()).hexdigest()}
print(json.dumps(summary,indent=2));(ROOT/'result.json').write_text(json.dumps(summary,indent=2))
