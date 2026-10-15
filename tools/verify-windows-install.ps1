param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$Report
)
$ErrorActionPreference = 'Stop'
$icon = Join-Path $PSScriptRoot '..\apps\desktop\assets\vantara.ico'
# NSIS may store an 8.3 target for Uninstall.exe; compare its actual long path.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class VantaraShortcutPath {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint GetLongPathName(string path, StringBuilder result, uint length);
  public static string Long(string path) {
    var result=new StringBuilder(32768);
    uint size=GetLongPathName(path,result,(uint)result.Capacity);
    if(size==0 || size>=result.Capacity) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    return result.ToString();
  }
}
'@
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
  # Read identical shortcut bytes through an ASCII filename: WSH's filename
  # lookup can depend on the runner locale for an Arabic .lnk name.
  $readPath = Join-Path $env:RUNNER_TEMP ("vantara-link-" + [Guid]::NewGuid().ToString('N') + '.lnk')
  Copy-Item -LiteralPath $linkPath -Destination $readPath
  $link = $shell.CreateShortcut($readPath)
  $expectedExe = if ([IO.Path]::GetFileName($linkPath) -eq 'إزالة VANTARA.lnk') { 'Uninstall.exe' } else { 'VANTARA.exe' }
  $expectedTarget = Join-Path $InstallDir $expectedExe
  @{shortcut=$linkPath;target=$link.TargetPath;icon=$link.IconLocation;expected=$expectedTarget;targetExists=(Test-Path -LiteralPath $link.TargetPath)} | ConvertTo-Json -Compress | Write-Host
  if ([VantaraShortcutPath]::Long($link.TargetPath) -ne [VantaraShortcutPath]::Long($expectedTarget)) { throw "Incorrect shortcut target: $linkPath actual=$($link.TargetPath) expected=$expectedTarget" }
  if ([VantaraShortcutPath]::Long(($link.IconLocation -replace '\s*,\s*0$', '')) -ne [VantaraShortcutPath]::Long($expectedTarget)) { throw "Shortcut does not use the branded executable icon: $linkPath" }
  Remove-Item -LiteralPath $readPath
  $links += @{ name = [IO.Path]::GetFileName($linkPath); desktop = ([IO.Path]::GetDirectoryName($linkPath) -eq [Environment]::GetFolderPath('Desktop')); brandedIcon = $true }
}
$entry = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA'
if ($entry.DisplayVersion -ne $ExpectedVersion) { throw 'Installed version does not match release' }
if ($entry.InstallLocation -ne $InstallDir) { throw 'Registry install location does not match chosen drive' }
if ($entry.DisplayIcon -ne ('"' + (Join-Path $InstallDir 'VANTARA.exe') + '",0')) { throw 'Installed-app registry icon is missing' }
$result = @{ version = $ExpectedVersion; binaries = $checks; shortcuts = $links; registryIcon = $true; installLocationVerified = $true }
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Report
$result | ConvertTo-Json -Depth 8
