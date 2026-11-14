# إثبات التحديث الداخلي لـ Windows Debug على ويندوز حقيقي (CI)، بعد نشر البناء الجديد N+1:
#   1) يثبّت البناء المنشور السابق N من إصداره (windows-debug-N) كما يثبّته المستخدم.
#   2) يشغّل VANTARA N في وضع --update-smoke-report: «البحث عن تحديثات» ← «تنزيل وتثبيت» ← «أعد التشغيل وحدّث»
#      من الواجهة نفسها، مع فحص حارس الرجوع (نفس البناء، الأقدم، مثبّت Stable، مضيف غريب) بالكود الحقيقي.
#   3) ينتظر المثبّت الصامت فوق المجلد نفسه وإعادة التشغيل، ثم يقلع التطبيق ويتحقق: 0.4.(N+1) وبناؤه،
#      ومفتاح السجل، وبقاء بيانات المستخدم (ملف userData ومفتاح localStorage).
#   4) Debug وStable جنبًا إلى جنب: مجلد ومفتاح سجل واختصارات وبيانات مختلفة، وإزالة أحدهما لا تمس الآخر.
param(
  [Parameter(Mandatory=$true)][int]$PreviousBuild,
  [Parameter(Mandatory=$true)][int]$NewBuild,
  [Parameter(Mandatory=$true)][string]$Report
)
$ErrorActionPreference = 'Stop'
$result = [ordered]@{ previousBuild = $PreviousBuild; newBuild = $NewBuild; previousVersion = "0.4.$PreviousBuild"; newVersion = "0.4.$NewBuild" }
function Save { $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report -Encoding utf8 }
function Wait-Exit($proc, $ms, $label) { if (-not $proc.WaitForExit($ms)) { $proc.Kill(); throw "$label timed out" } }
$product = 'VANTARA Debug'
$target = Join-Path $env:RUNNER_TEMP 'VANTARA-Debug-update'
$exe = Join-Path $target 'VANTARA.exe'
$userData = Join-Path $env:APPDATA $product
$dl = Join-Path $env:RUNNER_TEMP 'update-e2e'
New-Item -ItemType Directory -Force $dl | Out-Null
try {
  if ($NewBuild -le $PreviousBuild) { throw "New build $NewBuild is not newer than $PreviousBuild" }
  # ── 1) البناء السابق كما نُشر ──
  gh release download "windows-debug-$PreviousBuild" --repo $env:GITHUB_REPOSITORY --pattern "VANTARA-Debug-0.4.$PreviousBuild-Windows-x64-Setup.exe" --dir $dl --clobber
  if ($LASTEXITCODE -ne 0) { throw "Previous Debug installer windows-debug-$PreviousBuild not downloadable" }
  $setup = Join-Path $dl "VANTARA-Debug-0.4.$PreviousBuild-Windows-x64-Setup.exe"
  $p = Start-Process $setup -ArgumentList "/S /D=$target" -PassThru; Wait-Exit $p 180000 'Install previous build'
  if ($p.ExitCode -ne 0) { throw "Previous installer exit $($p.ExitCode)" }
  if (-not (Test-Path (Join-Path $target 'resources\app\update-smoke.cjs'))) {
    $result.skipped = "build $PreviousBuild predates the in-app update smoke; the first N->N+1 proof runs on the next published build"
    Save; Write-Warning $result.skipped; return
  }
  # بناءات 6–9: إثبات الإقلاع فيها ينتظر الواجهة (#root .v35) وحدها، وتثبيت جديد بلا حساب يعرض شاشة الدخول
  # (#root .gate)، فتنتهي مهلته قبل «البحث عن تحديثات» أيًّا كان التحديث (تشغيل #9). الكود قديم ومنشور فلا يُصلح؛
  # الإثبات الحقيقي يعمل من أول بناء منشور بالإصلاح (BOOT_READY_JS) كسابق. يُسجَّل صراحة في التقرير والسجل.
  $smokeCode = Get-Content (Join-Path $target 'resources\app\update-smoke.cjs') -Raw
  if ($smokeCode -notmatch 'BOOT_READY_JS') {
    $result.blocked = "build $PreviousBuild's update proof waits for the signed-in shell only (#root .v35) and times out on the fresh-install login gate; the N->N+1 proof runs from the first published build that has BOOT_READY_JS"
    Save; Write-Warning $result.blocked; return
  }
  # ── 2) التحديث من داخل التطبيق ──
  $smokeReport = Join-Path $dl 'update-smoke.json'
  $p = Start-Process $exe -ArgumentList "--update-smoke-report=`"$smokeReport`"" -PassThru
  Wait-Exit $p 1500000 'In-app update (check + download)'
  $smoke = Get-Content $smokeReport -Raw | ConvertFrom-Json
  $result.inApp = $smoke
  if ($smoke.error) { throw "In-app update failed at $($smoke.stage): $($smoke.error)" }
  if ($smoke.check.update.build -ne $NewBuild) { throw "In-app check offered build $($smoke.check.update.build), expected $NewBuild" }
  if (-not $smoke.download.sha256Matches) { throw 'Downloaded installer SHA-256 mismatch' }
  # ── 3) المثبّت الصامت فوق المجلد نفسه، ثم إعادة التشغيل ──
  $channelFile = Join-Path $target 'resources\app\channel.json'
  $deadline = (Get-Date).AddMinutes(6)
  do {
    Start-Sleep -Seconds 2
    $build = try { (Get-Content $channelFile -Raw | ConvertFrom-Json).build } catch { $null }
    $installer = Get-Process | Where-Object { $_.Path -like '*\updates\*Setup.exe' }
  } while (($build -ne $NewBuild -or $installer) -and (Get-Date) -lt $deadline)
  if ($build -ne $NewBuild) { throw "Installed channel.json build is $build after update, expected $NewBuild" }
  $result.installedOverSameFolder = $true
  $relaunched = $null; $deadline = (Get-Date).AddSeconds(90)
  while (-not $relaunched -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1; $relaunched = Get-Process VANTARA -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } }
  $result.relaunchedAfterUpdate = [bool]$relaunched
  if (-not $relaunched) { throw 'The installer did not relaunch VANTARA Debug after the update' }
  $relaunched | Stop-Process -Force; Start-Sleep -Seconds 3
  $bootReport = Join-Path $dl 'after-update-boot.json'
  $p = Start-Process $exe -ArgumentList "--smoke-report=`"$bootReport`"" -PassThru; Wait-Exit $p 120000 'Boot after update'
  $boot = Get-Content $bootReport -Raw | ConvertFrom-Json
  $result.afterUpdate = [ordered]@{ version = $boot.desktopVersion; build = $boot.desktopBuild; channel = $boot.desktopChannel; localStorageKept = ($boot.updateSmokeMarker -eq $smoke.marker); userDataFileKept = ((Get-Content (Join-Path $userData 'update-smoke-marker.txt') -Raw) -eq $smoke.marker) }
  if ($boot.desktopVersion -ne "0.4.$NewBuild" -or $boot.desktopBuild -ne $NewBuild -or $boot.desktopChannel -ne 'debug') { throw "After update the app reports $($boot.desktopVersion) build $($boot.desktopBuild)" }
  if (-not $result.afterUpdate.localStorageKept -or -not $result.afterUpdate.userDataFileKept) { throw 'User data did not survive the update' }
  $entry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
  if ($entry.DisplayVersion -ne "0.4.$NewBuild" -or $entry.InstallLocation -ne $target) { throw "Registry after update: $($entry.DisplayVersion) at $($entry.InstallLocation)" }
  $result.registryAfterUpdate = $entry.DisplayVersion
  # ── 4) Debug وStable جنبًا إلى جنب ──
  $stableUrl = $null
  try { $manifest = Invoke-RestMethod 'https://github.com/Meshal515/VANTARA/releases/latest/download/vantara-update.json'; $stableUrl = $manifest.desktop.url }
  catch { $result.sideBySide = @{ skipped = "Stable manifest unavailable: $($_.Exception.Message)" } }
  if ($stableUrl -and $stableUrl -notmatch '^https://github\.com/Meshal515/VANTARA/releases/download/stable-\d+/VANTARA-[\d.]+-Windows-x64-Setup\.exe$') { $result.sideBySide = @{ skipped = "Stable manifest has no official Windows installer: $stableUrl" }; $stableUrl = $null }
  if ($stableUrl) {
    $stableSetup = Join-Path $dl ([IO.Path]::GetFileName($stableUrl))
    Invoke-WebRequest $stableUrl -OutFile $stableSetup
    if ((Get-FileHash $stableSetup -Algorithm SHA256).Hash.ToLower() -ne $manifest.desktop.sha256) { throw 'Stable installer SHA-256 mismatch' }
    $stableDir = Join-Path $env:RUNNER_TEMP 'VANTARA-stable-side'
    $p = Start-Process $stableSetup -ArgumentList "/S /D=$stableDir" -PassThru; Wait-Exit $p 180000 'Install Stable'
    $stableEntry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA'
    $debugEntry = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product"
    $programs = [Environment]::GetFolderPath('Programs')
    $side = [ordered]@{
      stableVersion = $stableEntry.DisplayVersion
      separateFolders = ($stableEntry.InstallLocation -ne $debugEntry.InstallLocation)
      debugUntouched = ((Test-Path $exe) -and $debugEntry.DisplayVersion -eq "0.4.$NewBuild")
      separateShortcuts = ((Test-Path (Join-Path $programs 'VANTARA\VANTARA.lnk')) -and (Test-Path (Join-Path $programs "$product\$product.lnk")))
      separateUserData = ((Join-Path $env:APPDATA 'VANTARA') -ne $userData)
    }
    $stableBoot = Join-Path $dl 'stable-boot.json'
    $p = Start-Process (Join-Path $stableDir 'VANTARA.exe') -ArgumentList "--smoke-report=`"$stableBoot`"" -PassThru; Wait-Exit $p 120000 'Stable boot'
    $sb = Get-Content $stableBoot -Raw | ConvertFrom-Json
    $side.stableBoots = ($sb.desktop -eq 'windows' -and $sb.hasBridge)
    $side.stableDidNotTouchDebugData = ((Get-Content (Join-Path $userData 'update-smoke-marker.txt') -Raw) -eq $smoke.marker)
    $p = Start-Process (Join-Path $stableDir 'Uninstall.exe') -ArgumentList '/S' -PassThru; Wait-Exit $p 120000 'Stable uninstall'
    Start-Sleep -Seconds 5
    $side.debugSurvivesStableUninstall = ((Test-Path $exe) -and (Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$product").DisplayVersion -eq "0.4.$NewBuild")
    $result.sideBySide = $side
    foreach ($k in @('separateFolders','debugUntouched','separateShortcuts','separateUserData','stableBoots','stableDidNotTouchDebugData','debugSurvivesStableUninstall')) { if ($side[$k] -ne $true) { throw "Side-by-side check failed: $k" } }
  }
  $result.passed = $true
} catch {
  $result.error = $_.Exception.Message
  Save
  throw
} finally {
  Get-Process VANTARA -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Save
$result | ConvertTo-Json -Depth 8
