param(
  [ValidateSet('Env','Setup','Check','Build','Dev','Package','Test','Integration')][string]$Action='Env',
  [string]$ServerOrigin,
  [string]$Profile='development'
)
$ErrorActionPreference='Stop'
$desktopRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$desktopLocal=[IO.Path]::GetFullPath((Join-Path $desktopRoot '.local/electron'))
if(-not $desktopRoot.StartsWith('D:\',[StringComparison]::OrdinalIgnoreCase)){throw 'DESKTOP_DEVELOPMENT_REQUIRES_D_DRIVE'}
function Assert-DesktopPath([string]$Target){
  $resolved=[IO.Path]::GetFullPath($Target)
  if($resolved -ne $desktopLocal -and -not $resolved.StartsWith($desktopLocal+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'DESKTOP_PATH_OUTSIDE_OWNED_ROOT'}
  $part=$resolved
  while($part){
    if(Test-Path -LiteralPath $part){if((Get-Item -LiteralPath $part -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'DESKTOP_REPARSE_POINT_REJECTED'}}
    $part=[IO.Path]::GetDirectoryName($part)
  }
  return $resolved
}
foreach($relative in @('tools','cache/npm','cache/electron','cache/electron-builder','cache/node-compile','cache/node-gyp','temp','compiled','stage','releases','profiles','logs')){
  $directory=Assert-DesktopPath (Join-Path $desktopLocal $relative)
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$probe=Join-Path $desktopLocal ('temp/write-'+[Guid]::NewGuid().ToString('N'))
[IO.File]::WriteAllText($probe,'probe');Remove-Item -LiteralPath $probe
$env:TEMP=Join-Path $desktopLocal 'temp';$env:TMP=$env:TEMP;$env:TMPDIR=$env:TEMP
$env:npm_config_cache=Join-Path $desktopLocal 'cache/npm'
$env:electron_config_cache=Join-Path $desktopLocal 'cache/electron'
$env:ELECTRON_CACHE=$env:electron_config_cache
$env:ELECTRON_BUILDER_CACHE=Join-Path $desktopLocal 'cache/electron-builder'
$env:NODE_COMPILE_CACHE=Join-Path $desktopLocal 'cache/node-compile'
$env:npm_config_devdir=Join-Path $desktopLocal 'cache/node-gyp'
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
$versions=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'versions.json') -Raw | ConvertFrom-Json
$nodeName='node-v'+$versions.node+'-win-x64'
$nodeDirectory=Join-Path $desktopLocal ('tools/'+$nodeName)
$nodeExe=Join-Path $nodeDirectory 'node.exe'
if($Action -eq 'Setup' -and -not (Test-Path -LiteralPath $nodeExe)){
  $archive=Assert-DesktopPath (Join-Path $desktopLocal ('tools/'+$nodeName+'.zip'))
  $base='https://nodejs.org/dist/v'+$versions.node+'/'
  $checks=(Invoke-WebRequest -Uri ($base+'SHASUMS256.txt')).Content
  $line=@($checks -split "`n" | Where-Object { $_.TrimEnd().EndsWith('  '+$nodeName+'.zip') })
  if($line.Count -ne 1){throw 'NODE_OFFICIAL_CHECKSUM_MISSING'}
  if(-not (Test-Path -LiteralPath $archive)){Invoke-WebRequest -Uri ($base+$nodeName+'.zip') -OutFile $archive}
  if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $line[0].Substring(0,64)){throw 'NODE_ARCHIVE_CHECKSUM_MISMATCH'}
  Expand-Archive -LiteralPath $archive -DestinationPath (Assert-DesktopPath (Join-Path $desktopLocal 'tools'))
}
if(-not (Test-Path -LiteralPath $nodeExe)){throw 'RUN_DESKTOP_SETUP_FIRST'}
$env:PATH=$nodeDirectory+';'+$env:PATH
if((& $nodeExe --version) -ne ('v'+$versions.node)){throw 'DESKTOP_NODE_VERSION_MISMATCH'}
if($Profile -notmatch '^[a-zA-Z0-9-]{1,64}$'){throw 'DESKTOP_PROFILE_INVALID'}
$env:WECOM_DESKTOP_DATA_ROOT=Assert-DesktopPath (Join-Path $desktopLocal ('profiles/'+$Profile))
New-Item -ItemType Directory -Path $env:WECOM_DESKTOP_DATA_ROOT -Force | Out-Null
function Invoke-DesktopNode([string[]]$Arguments){
  & $nodeExe @Arguments
  if($LASTEXITCODE -ne 0){throw ('DESKTOP_COMMAND_FAILED:'+ $Arguments[0])}
}
Push-Location $desktopRoot
try{
  if($Action -eq 'Setup'){
    Invoke-DesktopNode @((Join-Path $nodeDirectory 'node_modules/npm/bin/npm-cli.js'),'install','--save-dev','--save-exact',('electron@'+$versions.electron),('electron-builder@'+$versions.electronBuilder),'--ignore-scripts','--no-audit','--no-fund')
    # Version 45 uses install-electron; resolve its declared bin instead of guessing a global npx.
    $electronPackage=Get-Content 'node_modules/electron/package.json' -Raw | ConvertFrom-Json
    $installer=$electronPackage.bin.'install-electron'
    if($installer){Invoke-DesktopNode @((Join-Path $desktopRoot ('node_modules/electron/'+$installer)))}
    else{Invoke-DesktopNode @((Join-Path $desktopRoot 'node_modules/electron/install.js'))}
  }
  if($Action -eq 'Env' -or $Action -eq 'Setup'){
    [ordered]@{node=$nodeExe;localRoot=$desktopLocal;temp=$env:TEMP;npmCache=$env:npm_config_cache;electronCache=$env:electron_config_cache;builderCache=$env:ELECTRON_BUILDER_CACHE;profile=$env:WECOM_DESKTOP_DATA_ROOT}|ConvertTo-Json
    return
  }
  $tsc=Join-Path $desktopRoot 'node_modules/typescript/bin/tsc'
  Invoke-DesktopNode @($tsc,'-p',(Join-Path $PSScriptRoot 'tsconfig.json'))
  if($Action -eq 'Check'){return}
  if($Action -eq 'Test'){
    Invoke-DesktopNode @('--test',(Join-Path $desktopLocal 'compiled/policy.test.mjs'),(Join-Path $desktopLocal 'compiled/navigation-errors.test.mjs'))
    return
  }
  if($Action -eq 'Integration'){
    $env:WECOM_DESKTOP_INTEGRATION='true'
    Invoke-DesktopNode @('--test','--test-concurrency=1',(Join-Path $desktopRoot '.build/runtime/tests/pc-admin-electron.browser.test.mjs'))
    return
  }
  if(-not $ServerOrigin){throw 'DESKTOP_SERVER_ORIGIN_REQUIRED'}
  $parsed=[Uri]$ServerOrigin
  if($parsed.Scheme -ne 'https' -or $parsed.GetLeftPart([UriPartial]::Authority) -cne $ServerOrigin -or $parsed.UserInfo -or $parsed.Host.EndsWith('.invalid')){throw 'DESKTOP_HTTPS_ORIGIN_REQUIRED'}
  $stage=Assert-DesktopPath (Join-Path $desktopLocal 'stage')
  # The staging allowlist prevents root dependencies, private settings and server code entering the package.
  foreach($file in @('main.mjs','policy.mjs','preload.cjs','chrome.mjs','chrome-preload.cjs')){Copy-Item -LiteralPath (Join-Path $desktopLocal ('compiled/'+$file)) -Destination (Join-Path $stage $file) -Force}
  foreach($file in @('unavailable.html','chrome.html','login-chrome.html','chrome.css')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stage -Force}
  @{schemaVersion=1;serverOrigin=$ServerOrigin}|ConvertTo-Json -Compress|Set-Content -LiteralPath (Join-Path $stage 'desktop.config.json') -Encoding utf8
  @{name='wecom-it-workbench';productName='医小修工作台';version=$versions.application;private=$true;type='module';main='main.mjs';description='信息科工单工作台';author='Hospital IT';license='UNLICENSED';dependencies=@{}}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $stage 'package.json') -Encoding utf8
  Add-Type -AssemblyName System.Drawing
  $bitmap=[Drawing.Bitmap]::new(256,256);$graphics=[Drawing.Graphics]::FromImage($bitmap)
  try{
    $graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::FromArgb(30,65,57))
    $pen=[Drawing.Pen]::new([Drawing.Color]::FromArgb(245,244,234),22)
    try{$graphics.DrawEllipse($pen,48,48,160,160);$graphics.DrawLine($pen,128,83,128,173);$graphics.DrawLine($pen,83,128,173,128)}finally{$pen.Dispose()}
    $bitmap.Save((Join-Path $stage 'icon.png'),[Drawing.Imaging.ImageFormat]::Png)
    $png=[IO.File]::ReadAllBytes((Join-Path $stage 'icon.png'));$stream=[IO.File]::Create((Join-Path $stage 'icon.ico'));$writer=[IO.BinaryWriter]::new($stream)
    try{$writer.Write([UInt16]0);$writer.Write([UInt16]1);$writer.Write([UInt16]1);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([UInt16]1);$writer.Write([UInt16]32);$writer.Write([UInt32]$png.Length);$writer.Write([UInt32]22);$writer.Write($png)}finally{$writer.Dispose()}
  }finally{$graphics.Dispose();$bitmap.Dispose()}
  if($Action -eq 'Dev'){& (Join-Path $desktopRoot 'node_modules/electron/dist/electron.exe') $stage;return}
  if($Action -eq 'Package'){
    $config=@{appId='cn.mobimedical.yixiaoxiu.workbench';productName='医小修工作台';electronVersion=$versions.electron;electronDist=(Join-Path $desktopRoot 'node_modules/electron/dist');electronDownload=@{cache=$env:electron_config_cache};asar=$true;directories=@{app=$stage;output=(Join-Path $desktopLocal 'releases')};files=@('!node_modules/**/*','main.mjs','policy.mjs','preload.cjs','unavailable.html','chrome.html','login-chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs','desktop.config.json','icon.ico','icon.png','package.json');win=@{target=@(@{target='nsis';arch=@('x64')});icon=(Join-Path $stage 'icon.ico')};nsis=@{oneClick=$false;perMachine=$false;allowToChangeInstallationDirectory=$true;createDesktopShortcut=$true;createStartMenuShortcut=$true;include=(Join-Path $PSScriptRoot 'installer.nsh')};artifactName='Yixiaoxiu-Workbench-${version}-${arch}-Setup.${ext}'}
    $configFile=Join-Path $desktopLocal 'builder.json';$config|ConvertTo-Json -Depth 8|Set-Content -LiteralPath $configFile -Encoding utf8
    Invoke-DesktopNode @((Join-Path $desktopRoot 'node_modules/electron-builder/cli.js'),'--config',$configFile,'--win','--x64','--publish','never')
    Invoke-DesktopNode @((Join-Path $desktopLocal 'compiled/verify-package.mjs'))
    Get-ChildItem -LiteralPath (Join-Path $desktopLocal 'releases') -Filter '*Setup.exe' | ForEach-Object {Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256}
  }
}finally{Pop-Location}
