!macro customInit
  ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"

  ${If} $0 != ""
    ${If} $0 == "${VERSION}"
      MessageBox MB_ICONINFORMATION|MB_OK "MiraVault ${VERSION} ya esta instalado. Si continuas, se reparara o reinstalara la misma version."
    ${Else}
      MessageBox MB_ICONINFORMATION|MB_OK "MiraVault ya esta instalado (version $0). Este instalador actualizara la aplicacion a la version ${VERSION}."
    ${EndIf}
  ${Else}
    MessageBox MB_ICONINFORMATION|MB_OK "Bienvenido a MiraVault ${VERSION}. El instalador conservara tu configuracion y biblioteca entre actualizaciones futuras."
  ${EndIf}
!macroend
