; Never terminate a running workbench during a manual upgrade: unsent input and UNKNOWN commands may exist.
!macro customCheckAppRunning
  nsProcess::_FindProcess "医小修工作台.exe"
  Pop $0
  ${If} $0 == 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONEXCLAMATION "请先在工作台中核对未确认操作、保存输入，再从托盘菜单退出工作台后重新安装。"
    ${EndIf}
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend
