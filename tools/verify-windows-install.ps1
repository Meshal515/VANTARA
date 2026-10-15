param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$Report
)
$ErrorActionPreference = 'Stop'
$icon = Join-Path $PSScriptRoot '..\apps\desktop\assets\vantara.ico'
$checks = @()
foreach ($executable in @((Join-Path $InstallDir 'VANTARA.exe'), (Join-Path $InstallDir 'Uninstall.exe'), $Installer)) {
  $proof = & node (Join-Path $PSScriptRoot 'windows-icon-resources.mjs') $executable $icon
  if ($LASTEXITCODE -ne 0) { throw "VANTARA icon missing from $executable" }
  $checks += @{ file = [IO.Path]::GetFileName($executable); icon = ($proof | ConvertFrom-Json) }
}
$shell = New-Object -ComObject WScript.Shell
$links = @()
foreach ($linkPath in @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'VANTARA.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'VANTARA\VANTARA.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'VANTARA\إزالة VANTARA.lnk')
)) {
  if (-not (Test-Path -LiteralPath $linkPath)) { throw "Missing installed shortcut: $linkPath" }
  $link = $shell.CreateShortcut($linkPath)
  $expectedExe = if ([IO.Path]::GetFileName($linkPath) -eq 'إزالة VANTARA.lnk') { 'Uninstall.exe' } else { 'VANTARA.exe' }
  $expectedTarget = Join-Path $InstallDir $expectedExe
  if ($link.TargetPath -ne $expectedTarget) { throw "Incorrect shortcut target: $linkPath" }
  if (($link.IconLocation -replace '\s*,\s*0$', '') -ne $expectedTarget) { throw "Shortcut does not use the branded executable icon: $linkPath" }
  $links += @{ name = [IO.Path]::GetFileName($linkPath); desktop = ([IO.Path]::GetDirectoryName($linkPath) -eq [Environment]::GetFolderPath('Desktop')); brandedIcon = $true }
}
$entry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA'
if ($entry.DisplayVersion -ne $ExpectedVersion) { throw 'Installed version does not match release' }
if ($entry.InstallLocation -ne $InstallDir) { throw 'Registry install location does not match chosen drive' }
if ($entry.DisplayIcon -ne ('"' + (Join-Path $InstallDir 'VANTARA.exe') + '",0')) { throw 'Installed-app registry icon is missing' }
$result = @{ version = $ExpectedVersion; binaries = $checks; shortcuts = $links; registryIcon = $true; installLocationVerified = $true }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report
$result | ConvertTo-Json -Depth 8
