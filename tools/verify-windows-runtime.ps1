param([Parameter(Mandatory=$true)][string]$CandidateDir,[Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference='Stop'
$setup=Join-Path $CandidateDir "VANTARA-$Version-Windows-x64-Setup.exe"
$target=Join-Path $env:RUNNER_TEMP 'VANTARA-installed'
New-Item -ItemType Directory -Force (Join-Path $target 'VANTARA-data') | Out-Null
$sentinel=Join-Path $target 'VANTARA-data\keep-user-data.txt'
Set-Content $sentinel 'preserve across install and uninstall'
function Install-Candidate {
  $proc=Start-Process -FilePath $setup -ArgumentList "/S /D=$target" -PassThru
  if(-not $proc.WaitForExit(180000)){$proc.Kill();throw 'Installer timed out'}
  if($proc.ExitCode -ne 0){throw "Installer failed: $($proc.ExitCode)"}
  if(-not(Test-Path $sentinel)){throw 'Installer lost user data'}
}
Install-Candidate
Install-Candidate # existing install / update
./tools/verify-windows-install.ps1 -InstallDir $target -Installer $setup -ExpectedVersion $Version -Report (Join-Path $CandidateDir 'install-report.json')
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
$p=Start-Process (Join-Path $target 'Uninstall.exe') -ArgumentList '/S' -PassThru
if(-not $p.WaitForExit(120000)){$p.Kill();throw 'Uninstall timed out'}
$deadline=(Get-Date).AddSeconds(30)
while((Test-Path $exe) -and (Get-Date) -lt $deadline){Start-Sleep -Milliseconds 200}
if(Test-Path $exe){throw 'Uninstall did not remove application'}
if(-not(Test-Path $sentinel)){throw 'Uninstall lost user data'}
@{install=$true;upgradePreservesUserData=$true;uninstallPreservesUserData=$true;installedDrive=([IO.Path]::GetPathRoot($target));version=$Version} | ConvertTo-Json | Set-Content (Join-Path $CandidateDir 'lifecycle-report.json')
