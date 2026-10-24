!macro customInstall
  # Updates already have the Visual C++ runtime; skipping it keeps the
  # silent in-app update free of Microsoft's own progress window.
  ${IfNot} ${isUpdated}
  NSISdl::download https://aka.ms/vs/17/release/vc_redist.x64.exe "$INSTDIR\vc_redist.x64.exe"  
  
  ${If} ${FileExists} `$INSTDIR\vc_redist.x64.exe`
    ExecWait '$INSTDIR\vc_redist.x64.exe /passive /norestart' $1

    ${If} $1 != '0' 
      ${If} $1 != '3010' # The MSI "need to reboot" return code.
        ${If} $1 != '1638' # The MSI "already installed" return code.
          MessageBox MB_OK|MB_ICONEXCLAMATION 'WARNING: Room Forty Toolkit was unable to install the latest Visual C++ Redistributable package from Microsoft.'
        ${EndIf}
      ${EndIf}
    ${EndIf}

    # ${If} $1 == '3010'
    #     MessageBox MB_OK|MB_ICONEXCLAMATION 'You must restart your computer to complete the installation.'
    # ${EndIf}

  ${Else}
      MessageBox MB_OK|MB_ICONEXCLAMATION 'WARNING: Room Forty Toolkit was unable to download the latest Visual C++ Redistributable package from Microsoft.'
  ${EndIf}
  ${EndIf}

  # The app was called RoomFortyRecorder, then Bellhop: drop the old-name
  # shortcuts (the new ones point at the same app).
  Delete "$DESKTOP\RoomFortyRecorder.lnk"
  Delete "$SMPROGRAMS\RoomFortyRecorder.lnk"
  Delete "$DESKTOP\Bellhop.lnk"
  Delete "$SMPROGRAMS\Bellhop.lnk"

  FileOpen $0 "$INSTDIR\installername" w
  FileWrite $0 $EXEFILE
  FileClose $0
!macroend