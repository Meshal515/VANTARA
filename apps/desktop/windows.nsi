Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
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

Var Relaunch

; تحديث من داخل التطبيق: التطبيق يغلق ثم يشغّل المثبّت مباشرة. قبل أي كتابة ننتظر أن يتحرر كل
; ملف تنفيذي يعمل (الواجهة، محرك التورنت، المشغّل)؛ الكتابة فوق ملف مقفول كانت تُفشل التثبيت
; الصامت فيبقى الإصدار القديم ويعرض «التحديث جاهز» من جديد.
Function WaitUnlocked
  Exch $0
  Push $1
  Push $2
  StrCpy $1 0
  wait_loop:
    IfFileExists "$0" 0 wait_done
    ClearErrors
    FileOpen $2 "$0" a
    IfErrors 0 wait_open
    IntOp $1 $1 + 1
    IntCmp $1 300 wait_done
    Sleep 200
    Goto wait_loop
  wait_open:
    FileClose $2
  wait_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macro WaitUnlocked FILE
  Push "${FILE}"
  Call WaitUnlocked
!macroend

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "هذه النسخة تتطلب ويندوز 64 بت."
    Abort
  ${EndIf}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/RELAUNCH" $R1
  ${IfNot} ${Errors}
    StrCpy $Relaunch 1
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ${If} $Relaunch == 1
    Exec '"$INSTDIR\VANTARA.exe"'
  ${EndIf}
FunctionEnd

Section "VANTARA" SEC_MAIN
  SetShellVarContext current
  SetRegView 64
  !insertmacro WaitUnlocked "$INSTDIR\VANTARA.exe"
  !insertmacro WaitUnlocked "$INSTDIR\resources\app\native\rqbit.exe"
  !insertmacro WaitUnlocked "$INSTDIR\resources\app\native\mpv.exe"
  !insertmacro WaitUnlocked "$INSTDIR\resources\app\native\vantara-video-host.exe"
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
