$ErrorActionPreference='Stop'
$taskRoot='C:\Users\zqpet\.codex\artifacts\yxx-current-readiness-20261002\stage06-c03\checkout'
$art='C:\Users\zqpet\.codex\artifacts\yxx-current-readiness-20261002\stage06-c03\full-02'
$data='C:\Users\zqpet\.codex\artifacts\yxx-current-readiness-20261002\stage06-c03\full-02\pg-data'
$pgBin='D:\Program Files\PostgreSQL\18\bin'
if(Test-Path -LiteralPath $art){throw 'FULL_RUN_ALREADY_EXISTS'}
if([IO.Path]::GetFullPath($data) -ne (Join-Path $art 'pg-data')){throw 'OWNED_DATA_PATH_MISMATCH'}
New-Item -ItemType Directory -Path $art | Out-Null
$identity=Get-Content (Join-Path (Split-Path $taskRoot -Parent) 'candidate.json') -Raw | ConvertFrom-Json
$inventory=Get-Content (Join-Path (Split-Path $taskRoot -Parent) 'source-inventory.json') -Raw | ConvertFrom-Json
$probe=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$probe.Start();$port=$probe.LocalEndpoint.Port;$probe.Stop()
$started=$false;$testExit=$null;$stopExit=$null;$removed=$false;$problem=$null
try {
  Set-Location -LiteralPath $taskRoot
  if((git rev-parse HEAD) -ne $identity.tested_head -or (git status --porcelain)){throw 'FROZEN_CANDIDATE_DRIFT'}
  & "$pgBin\initdb.exe" -D $data -U postgres --auth=trust --encoding=UTF8 --locale=C *> (Join-Path $art 'pg-init.log')
  if($LASTEXITCODE -ne 0){throw 'OWNED_PG_INIT_FAILED'}
  $pgStart=Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList @('-D', ('"'+$data+'"'), '-l', ('"'+(Join-Path $art 'pg-server.log')+'"'), '-o', ('"-h 127.0.0.1 -p '+$port+' -c max_connections=30"'), '-w', 'start') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $art 'pg-start.log') -RedirectStandardError (Join-Path $art 'pg-start.stderr')
  $pgStart.WaitForExit()
  if($pgStart.ExitCode -ne 0){throw 'OWNED_PG_START_FAILED'}
  $started=$true
  & "$pgBin\createdb.exe" -h 127.0.0.1 -p $port -U postgres migration_ci *> (Join-Path $art 'pg-createdb.log')
  if($LASTEXITCODE -ne 0){throw 'OWNED_DATABASE_CREATE_FAILED'}
  $env:PILOT_DATABASE_URL="postgresql://postgres@127.0.0.1:$port/migration_ci"
  $env:TS_MIGRATION_TEST_DB_ISOLATED='1'
  node .build/runtime/scripts/migrate-current-baseline.mjs *> (Join-Path $art 'database-baseline.log')
  if($LASTEXITCODE -ne 0){throw 'OWNED_BASELINE_FAILED'}
  node .build/tools/run-tests.mjs --current-full --report-dir (Join-Path $art 'tests') *> (Join-Path $art 'tests.log')
  $testExit=$LASTEXITCODE
  Copy-Item -LiteralPath (Join-Path $taskRoot '.build/runtime/build-manifest.json') -Destination (Join-Path $art 'build-manifest.json')
  $observer=@'
import pg from 'pg';const p=new pg.Pool({connectionString:process.env.PILOT_DATABASE_URL,max:1});try{const r=await p.query("SELECT datname FROM pg_database WHERE datname NOT IN ('postgres','template0','template1','migration_ci')");console.log(JSON.stringify({remaining_databases:r.rows}));if(r.rowCount)process.exitCode=1;}finally{await p.end();}
'@
  node --input-type=module -e $observer *> (Join-Path $art 'remaining-databases.json')
  if($LASTEXITCODE -ne 0){throw 'OWNED_DATABASE_RESIDUALS'}
  if(git status --porcelain){throw 'FROZEN_CANDIDATE_DRIFT_AFTER_RUN'}
} catch {
  $problem=$_.Exception.Message
  [IO.File]::WriteAllText((Join-Path $art 'launcher-error.txt'),$problem)
} finally {
  if(Test-Path -LiteralPath (Join-Path $data 'postmaster.pid')){
    & "$pgBin\pg_ctl.exe" -D $data -m fast -w stop *> (Join-Path $art 'pg-stop.log')
    $stopExit=$LASTEXITCODE
  }
  $stopped=-not(Test-Path -LiteralPath (Join-Path $data 'postmaster.pid'))
  if($stopped -and (Test-Path -LiteralPath $data)){
    if([IO.Path]::GetFullPath($data) -ne 'C:\Users\zqpet\.codex\artifacts\yxx-current-readiness-20261002\stage06-c03\full-02\pg-data'){throw 'CLEANUP_PATH_REJECTED'}
    Remove-Item -LiteralPath 'C:\Users\zqpet\.codex\artifacts\yxx-current-readiness-20261002\stage06-c03\full-02\pg-data' -Recurse -Force
  }
  $removed=-not(Test-Path -LiteralPath $data)
  $summary=Join-Path $art 'tests/summary.json'
  $summaryHash=if(Test-Path -LiteralPath $summary){(Get-FileHash -LiteralPath $summary -Algorithm SHA256).Hash.ToLowerInvariant()}else{$null}
  $epoch=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $local=[DateTimeOffset]::FromUnixTimeMilliseconds($epoch).ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd HH:mm:ss')
  $confirmed=($started -and $stopExit -eq 0 -and $stopped -and $removed)
  @{schema_version=1;kind='OWNED_TEST_ENVIRONMENT';status=$(if($confirmed){'CLEANUP_CONFIRMED'}else{'CLEANUP_UNCONFIRMED'});
    event_time=$local;event_epoch_ms=[string]$epoch;tested_head=$identity.tested_head;tested_tree=$identity.tested_tree;
    candidate_fingerprint=$inventory.fingerprint;execution_summary_sha256=$summaryHash;test_exit_code=$testExit;
    postgres_stop_exit_code=$stopExit;postgres_stopped=$stopped;postgres_data_removed=$removed;
    owned_residuals=$(if($confirmed){0}else{1});preexisting_resources_touched=$false;started=$started;launcher_error=$problem
  } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $art 'environment-cleanup.json')
}
if($testExit -ne 0 -or -not $removed -or $problem){exit 1}
