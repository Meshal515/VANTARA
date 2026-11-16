Unicode true
!include "MUI2.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
; Debug يُبنى بـ-DPRODUCT_NAME="VANTARA Debug": مجلد تثبيت ومفتاح سجل واختصارات مستقلة عن Stable،
; فلا يكتب أحدهما فوق الآخر ولا يزيله مزيل الآخر.
!ifndef PRODUCT_NAME
  !define PRODUCT_NAME "VANTARA"
!endif
!ifndef FILE_DESCRIPTION
  !define FILE_DESCRIPTION "VANTARA for Windows"
!endif
Name "${PRODUCT_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${PRODUCT_NAME}"
InstallDirRegKey HKCU "Software\${PRODUCT_NAME}" "InstallLocation"
RequestExecutionLevel user
; Compress files independently so installing to another drive does not need a
; full solid archive decompressed into the user's (possibly almost full) TEMP.
SetCompressor zlib
VIProductVersion "${PRODUCT_VERSION}"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "FileDescription" "${FILE_DESCRIPTION}"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "VANTARA"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\VANTARA.exe"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل ${PRODUCT_NAME}"
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

Section "${PRODUCT_NAME}" SEC_MAIN
  SetShellVarContext current
  SetRegView 64
  !insertmacro WaitUnlocked "$INSTDIR\VANTARA.exe"
  !insertmacro WaitUnlocked "$INSTDIR\resources\app\native\rqbit.exe"
  !insertmacro WaitUnlocked "$INSTDIR\resources\app\native\vantara-torrent.exe"
  !insertmacro WaitUnlocked "$INSTDIR\resources\app\native\mpv.exe"
  !insertmacro WaitUnlocked "$INSTDIR\resources\app\native\vantara-video-host.exe"
  SetOutPath "$INSTDIR"
  File /r "${DIST}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortcut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\VANTARA.exe" "" "$INSTDIR\VANTARA.exe" 0
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\VANTARA.exe" "" "$INSTDIR\VANTARA.exe" 0
  CreateShortcut "$SMPROGRAMS\${PRODUCT_NAME}\إزالة ${PRODUCT_NAME}.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
  WriteRegStr HKCU "Software\${PRODUCT_NAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "DisplayIcon" "$\"$INSTDIR\VANTARA.exe$\",0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "UninstallString" "$\"$INSTDIR\Uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\إزالة ${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
  DeleteRegKey HKCU "Software\${PRODUCT_NAME}"
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
