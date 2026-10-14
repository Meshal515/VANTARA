param([string]$Output = "$PSScriptRoot/../apps/desktop/native/vantara-video-host.exe")
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path $compiler)) { throw 'Windows .NET Framework x64 compiler is required' }
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force ([IO.Path]::GetDirectoryName($Output)) | Out-Null
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$Output" "$PSScriptRoot/../apps/desktop/native-host/VideoHost.cs"
if ($LASTEXITCODE -ne 0) { throw 'Video host compilation failed' }
Get-FileHash -Algorithm SHA256 $Output
