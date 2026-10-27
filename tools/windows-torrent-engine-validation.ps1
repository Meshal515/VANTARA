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
node --test apps/desktop/src/services.test.mjs apps/desktop/src/libtorrent-engine.test.mjs apps/desktop/src/torrent-replay-startup.test.mjs apps/desktop/src/torrent-replay-cache.test.mjs apps/desktop/src/torrent-window.test.mjs apps/desktop/src/torrent-window.win.test.mjs tools/torrent-validation.test.mjs
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
$engineIdentity=$null
foreach($engine in @('rqbit','libtorrent')){
  $out=Join-Path $root "runs/$engine"
  $base=@('tools/torrent-startup-benchmark.mjs','--service-module','apps/desktop/src/services.mjs','--rqbit',$rqbit,'--mpv',$node,'--engine-only','true','--torrent-backend',$engine,'--libtorrent-python',$python,'--libtorrent-script',"$native/server.py",'--seed-engine','libtorrent','--fixtures-from',$fixtures,'--output',$out,'--runs','3','--kinds','mp4','--timeout-ms','30000','--required-bitrate','24000000')
  # These are two separate OS processes, not two service object instances.
  & node @base --modes cold,warm
  $firstExit=$LASTEXITCODE
  if(-not(Test-Path "$out/results.json")){throw 'Missing first-process evidence'}
  Copy-Item "$out/results.json" "$out/before-process-restart.json"
  $before=Get-Content "$out/results.json" -Raw | ConvertFrom-Json
  if($engineIdentity -and $engineIdentity -ne $before.fixtures[0].infoHash){throw 'Engine comparison changed torrent identity'}
  $engineIdentity=$before.fixtures[0].infoHash
  $processIds=@($before.serviceHostPid)
  $cacheRows=@()
  $cacheFailed=$false
  foreach($cacheMode in @('restart','partial','corrupt')){
    # Each persisted-cache mode starts a fresh OS application-services process.
    # In particular, partial replay cannot inherit module/session state from a
    # preceding full replay in this same process.
    & node @base --modes $cacheMode
    $cacheExit=$LASTEXITCODE
    if(-not(Test-Path "$out/results.json")){throw 'Missing restarted-process evidence'}
    Copy-Item "$out/results.json" "$out/process-$cacheMode.json"
    $cacheReport=Get-Content "$out/results.json" -Raw | ConvertFrom-Json
    $processIds+=@($cacheReport.serviceHostPid)
    if($before.fixtures[0].infoHash -ne $cacheReport.fixtures[0].infoHash){throw 'Process restart changed torrent identity'}
    if($cacheExit -ne 0){$cacheFailed=$true}
    $cacheRows+=@($cacheReport.runs)
  }
  if(@($before.runs).Count -ne 6 -or $cacheRows.Count -ne 9){throw 'Missing required engine samples'}
  if(@($processIds | Select-Object -Unique).Count -ne 4){throw 'Each cache mode must start a separate application-services process'}
  if($firstExit -ne 0 -or $cacheFailed -or @($before.runs | Where-Object {-not $_.ok}).Count -or @($cacheRows | Where-Object {-not $_.ok}).Count){$failures+=$engine}
  foreach($row in @($before.runs | Where-Object {$_.mode -eq 'cold'})){if($row.cacheBefore.available){throw 'Cold start unexpectedly reused replay cache'}}
  $expectedHash=$before.fixtures[0].infoHash
  foreach($mode in @('restart','partial','corrupt')){
    $rows=@($cacheRows | Where-Object {$_.mode -eq $mode})
    if($rows.Count -ne 3){throw 'Missing required restarted/cache samples'}
    foreach($row in $rows){if(-not $row.cacheBefore.available){throw 'Restart test had no persisted cache'}}
  }
  $prewarmOut=Join-Path $root "runs/prewarm-$engine"
  $prewarmBase=$base.Clone()
  $prewarmBase[[Array]::IndexOf($prewarmBase,'--output')+1]=$prewarmOut
  $prewarmBase[[Array]::IndexOf($prewarmBase,'--runs')+1]='1'
  & node @prewarmBase --prewarm true --modes cold
  $prewarmExit=$LASTEXITCODE
  Copy-Item "$prewarmOut/results.json" "$prewarmOut/before-process-restart.json"
  $prewarmed=Get-Content "$prewarmOut/results.json" -Raw | ConvertFrom-Json
  & node @prewarmBase --modes restart
  $prewarmRestartExit=$LASTEXITCODE
  $restarted=Get-Content "$prewarmOut/results.json" -Raw | ConvertFrom-Json
  if($prewarmExit -ne 0 -or $prewarmRestartExit -ne 0 -or -not $prewarmed.runs[0].prewarmAdopted -or -not $restarted.runs[0].ok -or -not $restarted.runs[0].cacheBefore.available -or $prewarmed.serviceHostPid -eq $restarted.serviceHostPid){$failures+="prewarm-restart-$engine"}
  $underrun=Join-Path $root "runs/underrun-$engine"
  & node tools/torrent-startup-benchmark.mjs --service-module apps/desktop/src/services.mjs --rqbit $rqbit --mpv $node --engine-only true --torrent-backend $engine --libtorrent-python $python --libtorrent-script "$native/server.py" --seed-engine libtorrent --seed-upload-bps 524288 --byte-scenario underrun --fixtures-from $fixtures --output $underrun --runs 1 --kinds mp4 --modes cold --timeout-ms 30000
  if($LASTEXITCODE -ne 0){$failures+="underrun-$engine"}
}
# The same exact bytes, independently of any video decoder. Expected negative
# controls must reproduce the explicit API rejection, not merely exit non-zero.
$protocols=@(
  @{name='utp-native';engine='libtorrent';transport='utp-closed-tcp';encryption='optional';rqbit='tcp';expected=$true},
  @{name='utp-rqbit';engine='rqbit';transport='utp-closed-tcp';encryption='optional';rqbit='production';expected=$true},
  @{name='utp-tcp-negative';engine='rqbit';transport='utp-closed-tcp';encryption='optional';rqbit='tcp';expected=$false},
  @{name='mse-native';engine='libtorrent';transport='both';encryption='mse';rqbit='tcp';expected=$true},
  @{name='mse-rqbit-negative';engine='rqbit';transport='both';encryption='mse';rqbit='both';expected=$false}
)
foreach($case in $protocols){
  $out=Join-Path $root "runs/protocol/$($case.name)"
  $samples=if($case.expected){'3'}else{'1'}
  $modes=if($case.expected){'cold,warm'}else{'cold'}
  & node tools/torrent-startup-benchmark.mjs --service-module apps/desktop/src/services.mjs --rqbit $rqbit --mpv $node --engine-only true --torrent-backend $case.engine --libtorrent-python $python --libtorrent-script "$native/server.py" --seed-engine libtorrent --byte-scenario protocol --seed-transport $case.transport --seed-encryption $case.encryption --rqbit-transport $case.rqbit --fixtures-from $fixtures --output $out --runs $samples --kinds mp4 --modes $modes --timeout-ms 12000
  $nativeExit=$LASTEXITCODE
  if(-not(Test-Path "$out/results.json")){throw 'Missing protocol evidence'}
  $report=Get-Content "$out/results.json" -Raw | ConvertFrom-Json
  if($report.fixtures[0].infoHash -ne $expectedHash -or $report.fixtures[0].fileIdx -ne 0){throw 'Protocol changed torrent/file identity'}
  $expectedSamples=if($case.expected){6}else{1}
  if(@($report.runs).Count -ne $expectedSamples){throw 'Missing protocol samples'}
  if($case.expected){
    if($nativeExit -ne 0 -or @($report.runs | Where-Object {-not $_.ok}).Count){$failures+=$case.name}
  }else{
    if($nativeExit -eq 0 -or $report.runs[0].ok -or $report.runs[0].startPlaybackError -notmatch 'رفض محرك التورنت الطلب'){throw "Missing exact negative protocol control: $($case.name)"}
    $global:LASTEXITCODE=0
  }
}
if($failures.Count){throw "Verified engine bytes/throughput failed: $($failures -join ', ')"}
