param(
  [Parameter(Mandatory = $true)][string]$InputExe,
  [Parameter(Mandatory = $true)][string]$OutputExe,
  [string]$Icon = (Join-Path $PSScriptRoot '..\apps\desktop\assets\vantara.ico')
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Win32 resource editing requires Windows' }
$inputPath = (Resolve-Path -LiteralPath $InputExe).Path
$iconPath = (Resolve-Path -LiteralPath $Icon).Path
$outputPath = [IO.Path]::GetFullPath($OutputExe)
if ($inputPath -eq $outputPath) { throw 'Input and output must differ; preserve the pinned upstream executable' }
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
Copy-Item -LiteralPath $inputPath -Destination $outputPath -Force

# Windows' resource API preserves Electron's code, manifest, version resources
# and other data. Remove all old icon languages so no shell can select Electron.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class VantaraIconResources {
  delegate bool NameCallback(IntPtr module, IntPtr type, IntPtr name, IntPtr param);
  delegate bool LanguageCallback(IntPtr module, IntPtr type, IntPtr name, ushort language, IntPtr param);
  [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32", SetLastError = true)] static extern bool FreeLibrary(IntPtr module);
  [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool EnumResourceNames(IntPtr module, IntPtr type, NameCallback callback, IntPtr param);
  [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool EnumResourceLanguages(IntPtr module, IntPtr type, IntPtr name, LanguageCallback callback, IntPtr param);
  [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
  [DllImport("kernel32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool UpdateResource(IntPtr update, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
  [DllImport("kernel32", SetLastError = true)] static extern bool EndUpdateResource(IntPtr update, bool discard);
  class Resource { public int Type; public ushort Language; public int Id; public string Name; }
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Apply(string executable, string icon) {
    byte[] ico = File.ReadAllBytes(icon);
    if (ico.Length < 6 || BitConverter.ToUInt16(ico, 0) != 0 || BitConverter.ToUInt16(ico, 2) != 1) throw new InvalidDataException("Invalid icon");
    int count = BitConverter.ToUInt16(ico, 4);
    if (count < 1 || ico.Length < 6 + count * 16) throw new InvalidDataException("Invalid icon directory");
    var old = new List<Resource>();
    IntPtr module = LoadLibraryEx(executable, IntPtr.Zero, 2 | 32);
    if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      foreach (int type in new int[] { 3, 14 }) {
        bool enumerated = EnumResourceNames(module, (IntPtr)type, (m, t, name, p) => {
          bool numeric = (ulong)name.ToInt64() <= 65535;
          return EnumResourceLanguages(m, t, name, (lm, lt, ln, language, lp) => {
            old.Add(new Resource { Type = type, Language = language, Id = numeric ? name.ToInt32() : 0, Name = numeric ? null : Marshal.PtrToStringUni(name) });
            return true;
          }, IntPtr.Zero);
        }, IntPtr.Zero);
        if (!enumerated && Marshal.GetLastWin32Error() != 1813) throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    } finally { FreeLibrary(module); }
    IntPtr update = BeginUpdateResource(executable, false);
    if (update == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    bool committed = false;
    try {
      foreach (var resource in old) {
        IntPtr name = resource.Name == null ? (IntPtr)resource.Id : Marshal.StringToHGlobalUni(resource.Name);
        try { Check(UpdateResource(update, (IntPtr)resource.Type, name, resource.Language, null, 0)); }
        finally { if (resource.Name != null) Marshal.FreeHGlobal(name); }
      }
      byte[] group = new byte[6 + count * 14];
      Array.Copy(ico, 0, group, 0, 6);
      for (int i = 0; i < count; i++) {
        int entry = 6 + i * 16;
        int size = checked((int)BitConverter.ToUInt32(ico, entry + 8));
        int start = checked((int)BitConverter.ToUInt32(ico, entry + 12));
        if (size <= 0 || start < 6 + count * 16 || start > ico.Length - size) throw new InvalidDataException("Invalid icon image");
        byte[] image = new byte[size];
        Array.Copy(ico, start, image, 0, size);
        Check(UpdateResource(update, (IntPtr)3, (IntPtr)(i + 1), 1033, image, (uint)size));
        Array.Copy(ico, entry, group, 6 + i * 14, 12);
        Array.Copy(BitConverter.GetBytes((ushort)(i + 1)), 0, group, 6 + i * 14 + 12, 2);
      }
      Check(UpdateResource(update, (IntPtr)14, (IntPtr)1, 1033, group, (uint)group.Length));
      Check(EndUpdateResource(update, false));
      committed = true;
    } finally { if (!committed) EndUpdateResource(update, true); }
  }
}
'@
[VantaraIconResources]::Apply($outputPath, $iconPath)
Write-Output "VANTARA icon embedded: $outputPath"
