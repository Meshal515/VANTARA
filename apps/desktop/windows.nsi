Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "VANTARA"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\VANTARA"
InstallDirRegKey HKCU "Software\VANTARA" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID zlib
VIProductVersion "0.1.0.3"
VIAddVersionKey "ProductName" "VANTARA"
VIAddVersionKey "FileDescription" "VANTARA Windows Preview"
VIAddVersionKey "FileVersion" "0.1.0-preview.3"
VIAddVersionKey "LegalCopyright" "VANTARA"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\VANTARA.exe"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل VANTARA"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "هذه النسخة تتطلب ويندوز 64 بت."
    Abort
  ${EndIf}
FunctionEnd

Section "VANTARA" SEC_MAIN
  SetRegView 64
  SetOutPath "$INSTDIR"
  File /r "${DIST}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\VANTARA"
  CreateShortcut "$SMPROGRAMS\VANTARA\VANTARA.lnk" "$INSTDIR\VANTARA.exe"
  CreateShortcut "$SMPROGRAMS\VANTARA\إزالة VANTARA.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\VANTARA" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "DisplayName" "VANTARA"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "DisplayVersion" "0.1.0-preview.3"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetRegView 64
  Delete "$SMPROGRAMS\VANTARA\VANTARA.lnk"
  Delete "$SMPROGRAMS\VANTARA\إزالة VANTARA.lnk"
  RMDir "$SMPROGRAMS\VANTARA"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA"
  DeleteRegKey HKCU "Software\VANTARA"
  RMDir /r "$INSTDIR"
SectionEnd
