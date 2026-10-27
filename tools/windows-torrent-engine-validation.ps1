# Owned bytes only. A separate Node application-services process is started on
# each side of restart. No MPV/codec/GPU is used to decide engine correctness.
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$root=Join-Path $env:RUNNER_TEMP 'vantara-engine-validation'
New-Item -ItemType Directory -Force -Path $root | Out-Null
$native=Join-Path $root 'native'
node tools/bundle-windows-libtorrent.mjs "--output=$native" "--cache=$root/cache"
if($LASTEXITCODE -ne 0){throw 'Pinned native bundle failed'}
$python=Join-Path $native 'python/python.exe'
& $python -I apps/desktop/native/libtorrent/server_test.py
if($LASTEXITCODE -ne 0){throw 'Native integrity, starvation, cancellation or priority regression'}
node --test apps/desktop/src/libtorrent-engine.test.mjs apps/desktop/src/torrent-replay-startup.test.mjs apps/desktop/src/torrent-replay-cache.test.mjs apps/desktop/src/torrent-window.test.mjs tools/torrent-validation.test.mjs
if($LASTEXITCODE -ne 0){throw 'Cache/policy regression'}
$rqbit=Join-Path $root 'rqbit.exe'
Invoke-WebRequest 'https://github.com/ikatson/rqbit/releases/download/v9.0.1/rqbit.exe' -OutFile $rqbit
if((Get-FileHash $rqbit -Algorithm SHA256).Hash.ToLower() -ne '2ed683203beca628e0c45f62f99feeef4242cecc3444c8422dfe5b1b6aa38cea'){throw 'rqbit checksum mismatch'}
$fixtures=Join-Path $root 'fixtures'
New-Item -ItemType Directory -Force -Path $fixtures | Out-Null
# 64 MiB of deterministic, position-dependent, non-zero data. A zero-filled
# sparse file or wrong seek position cannot produce the expected SHA256.
node --input-type=module -e 'import fs from "node:fs";import{createHash}from"node:crypto";const f=fs.openSync(process.argv[1],"w");for(let i=0;i<65536;i++){const b=Buffer.alloc(1024);for(let j=0;j<32;j++)createHash("sha256").update(`${i}:${j}`).digest().copy(b,j*32);fs.writeSync(f,b);}fs.closeSync(f);' (Join-Path $fixtures 'authored-mp4.mp4')
if($LASTEXITCODE -ne 0){throw 'Owned fixture generation failed'}
$node=(Get-Command node).Source
$failures=@()
foreach($engine in @('rqbit','libtorrent')){
  $out=Join-Path $root "runs/$engine"
  $base=@('tools/torrent-startup-benchmark.mjs','--service-module','apps/desktop/src/services.mjs','--rqbit',$rqbit,'--mpv',$node,'--engine-only','true','--torrent-backend',$engine,'--libtorrent-python',$python,'--libtorrent-script',"$native/server.py",'--seed-engine','libtorrent','--fixtures-from',$fixtures,'--output',$out,'--runs','3','--kinds','mp4','--timeout-ms','30000','--required-bitrate','24000000')
  # These are two separate OS processes, not two service object instances.
  & node @base --modes cold,warm
  $firstExit=$LASTEXITCODE
  if(-not(Test-Path "$out/results.json")){throw 'Missing first-process evidence'}
  Copy-Item "$out/results.json" "$out/before-process-restart.json"
  $before=Get-Content "$out/results.json" -Raw | ConvertFrom-Json
  & node @base --modes restart,partial,corrupt
  $secondExit=$LASTEXITCODE
  if(-not(Test-Path "$out/results.json")){throw 'Missing restarted-process evidence'}
  $after=Get-Content "$out/results.json" -Raw | ConvertFrom-Json
  if($before.serviceHostPid -eq $after.serviceHostPid){throw 'Application-services process did not restart'}
  if($before.fixtures[0].infoHash -ne $after.fixtures[0].infoHash){throw 'Restart changed torrent identity'}
  if($firstExit -ne 0 -or $secondExit -ne 0 -or @($before.runs | Where-Object {-not $_.ok}).Count -or @($after.runs | Where-Object {-not $_.ok}).Count){$failures+=$engine}
  foreach($mode in @('restart','partial','corrupt')){
    $rows=@($after.runs | Where-Object {$_.mode -eq $mode})
    if($rows.Count -ne 3){throw 'Missing required restarted/cache samples'}
    foreach($row in $rows){if(-not $row.cacheBefore.available){throw 'Restart test had no persisted cache'}}
  }
}
if($failures.Count){throw "Verified engine bytes/throughput failed: $($failures -join ', ')"}
