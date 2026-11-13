param([Parameter(Mandatory=$true)][string]$CandidateDir,[Parameter(Mandatory=$true)][string]$Version,[string]$Product='VANTARA',[string]$TorrentFixtures='',[switch]$KeepInstalled)
$ErrorActionPreference='Stop'
$prefix=if($Product -eq 'VANTARA Debug'){'VANTARA-Debug'}else{'VANTARA'}
$setup=Join-Path $CandidateDir "$prefix-$Version-Windows-x64-Setup.exe"
$target=Join-Path $env:RUNNER_TEMP "$prefix-installed"
$dataName=if($Product -eq 'VANTARA Debug'){'VANTARA-Debug-data'}else{'VANTARA-data'}
New-Item -ItemType Directory -Force (Join-Path $target $dataName) | Out-Null
$sentinel=Join-Path $target "$dataName\keep-user-data.txt"
Set-Content $sentinel 'preserve across install and uninstall'
function Install-Candidate {
  $proc=Start-Process -FilePath $setup -ArgumentList "/S /D=$target" -PassThru
  if(-not $proc.WaitForExit(180000)){$proc.Kill();throw 'Installer timed out'}
  if($proc.ExitCode -ne 0){throw "Installer failed: $($proc.ExitCode)"}
  if(-not(Test-Path $sentinel)){throw 'Installer lost user data'}
}
Install-Candidate
Install-Candidate # existing install / update
./tools/verify-windows-install.ps1 -InstallDir $target -Installer $setup -ExpectedVersion $Version -Product $Product -Report (Join-Path $CandidateDir 'install-report.json')
$exe=Join-Path $target 'VANTARA.exe'
$native=Join-Path $target 'resources\app\native'
node tools/windows-native-smoke.mjs "$native" (Join-Path $CandidateDir 'native-report.json')
if($LASTEXITCODE -ne 0){throw 'Native MPV playback failed'}
node tools/windows-native-smoke.mjs "$native" (Join-Path $CandidateDir 'native-4k-report.json') 'tools/fixtures/vantara-4k-hevc10.mp4'
if($LASTEXITCODE -ne 0){throw 'Actual 4K HEVC10 MPV playback failed'}
$embeddedReport=Join-Path $CandidateDir 'embedded-report.json'
$fixture=(Resolve-Path 'android/app/src/androidTest/assets/addon-torrent-proof.mp4').Path
$p=Start-Process $exe -ArgumentList @("--native-video-smoke-report=`"$embeddedReport`"","--native-video-smoke-fixture=`"$fixture`"") -PassThru
if(-not $p.WaitForExit(180000)){$p.Kill();throw 'Embedded video timed out'}
if($p.ExitCode -ne 0){throw "Embedded video exit $($p.ExitCode)"}
$embedded=Get-Content $embeddedReport -Raw | ConvertFrom-Json
foreach($key in @('realMpv','realElectron','realEmbeddedChild','resized','fullscreen','rendererControls','arabicSubtitleSelected','overlaySubtitleDelay','cleanup')){
  if($embedded.$key -ne $true){throw "Embedded proof failed: $key"}
}
$bootReport=Join-Path $CandidateDir 'boot-report.json'
$p=Start-Process $exe -ArgumentList "--smoke-report=`"$bootReport`"" -PassThru
if(-not $p.WaitForExit(120000)){$p.Kill();throw 'Application boot timed out'}
if($p.ExitCode -ne 0){throw "Boot failed: $($p.ExitCode)"}
$boot=Get-Content $bootReport -Raw | ConvertFrom-Json
if(-not $boot.hasBridge -or $boot.desktop -ne 'windows' -or $boot.sourceCount -lt 27 -or (-not $boot.gate -and -not $boot.canonical)){throw 'Canonical desktop application did not boot'}
if($boot.assetFailures.Count -or $boot.failedLoads.Count -or $boot.rendererExits.Count){throw 'Application load failure'}
# تشغيل تورنت حقيقي داخل التطبيق المثبت: libtorrent المرفق + mpv المدمج، لكل fixture (1080p/2K/4K)
if($TorrentFixtures){
  $results=@()
  foreach($fixture in (Get-ChildItem -LiteralPath $TorrentFixtures -Filter '*.mp4' | Sort-Object Name)){
    $torrentReport=Join-Path $CandidateDir ("torrent-" + $fixture.BaseName + ".json")
    $p=Start-Process $exe -ArgumentList @("--native-torrent-smoke-report=`"$torrentReport`"","--native-torrent-smoke-fixture=`"$($fixture.FullName)`"") -PassThru
    if(-not $p.WaitForExit(240000)){$p.Kill();throw "Torrent playback timed out: $($fixture.Name)"}
    if(-not(Test-Path $torrentReport)){throw "Torrent playback produced no report: $($fixture.Name)"}
    $r=Get-Content $torrentReport -Raw | ConvertFrom-Json
    $r | ConvertTo-Json -Depth 6 | Write-Host
    if($r.error){throw "Torrent playback failed ($($fixture.Name)): $($r.error)"}
    foreach($key in @('ready','embedded','progressed','seeked','cleanup')){if($r.$key -ne $true){throw "Torrent proof failed ($($fixture.Name)): $key"}}
    if($r.engine -ne 'libtorrent' -or $r.fallback){throw "Torrent proof did not use libtorrent ($($fixture.Name)): engine=$($r.engine) fallback=$($r.fallback)"}
    $results+=$r | Select-Object @{n='fixture';e={$fixture.Name}},engine,clickToReadyMs,seekMs,stalls,fileBytes
  }
  $results | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $CandidateDir 'torrent-summary.json')
}
if($KeepInstalled){return}
$p=Start-Process (Join-Path $target 'Uninstall.exe') -ArgumentList '/S' -PassThru
if(-not $p.WaitForExit(120000)){$p.Kill();throw 'Uninstall timed out'}
$deadline=(Get-Date).AddSeconds(30)
while((Test-Path $exe) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 200}
if(Test-Path $exe){throw 'Uninstall did not remove application'}
if(-not(Test-Path $sentinel)){throw 'Uninstall lost user data'}
@{install=$true;upgradePreservesUserData=$true;uninstallPreservesUserData=$true;installedDrive=([IO.Path]::GetPathRoot($target));version=$Version} | ConvertTo-Json | Set-Content (Join-Path $CandidateDir 'lifecycle-report.json')
