Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
Name "VANTARA"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\VANTARA"
InstallDirRegKey HKCU "Software\VANTARA" "InstallLocation"
RequestExecutionLevel user
; Compress files independently so installing to another drive does not need a
; full solid archive decompressed into the user's (possibly almost full) TEMP.
SetCompressor zlib
VIProductVersion "${PRODUCT_VERSION}"
VIAddVersionKey "ProductName" "VANTARA"
VIAddVersionKey "FileDescription" "VANTARA Windows Preview"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "VANTARA"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
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
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "هذه النسخة تتطلب ويندوز 64 بت."
    Abort
  ${EndIf}
FunctionEnd

Section "VANTARA" SEC_MAIN
  SetShellVarContext current
  SetRegView 64
  SetOutPath "$INSTDIR"
  File /r "${DIST}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\VANTARA"
  CreateShortcut "$DESKTOP\VANTARA.lnk" "$INSTDIR\VANTARA.exe" "" "$INSTDIR\VANTARA.exe" 0
  CreateShortcut "$SMPROGRAMS\VANTARA\VANTARA.lnk" "$INSTDIR\VANTARA.exe" "" "$INSTDIR\VANTARA.exe" 0
  CreateShortcut "$SMPROGRAMS\VANTARA\إزالة VANTARA.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
  WriteRegStr HKCU "Software\VANTARA" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "DisplayName" "VANTARA"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "DisplayIcon" "$\"$INSTDIR\VANTARA.exe$\",0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  Delete "$DESKTOP\VANTARA.lnk"
  Delete "$SMPROGRAMS\VANTARA\VANTARA.lnk"
  Delete "$SMPROGRAMS\VANTARA\إزالة VANTARA.lnk"
  RMDir "$SMPROGRAMS\VANTARA"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\VANTARA"
  DeleteRegKey HKCU "Software\VANTARA"
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
