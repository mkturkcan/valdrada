# Valdrada with the Unreal Engine 5 renderer (Windows): starts the headless core (the simulation and the Python API on
# port 2000) and the Unreal renderer connected to it, and stops both when either exits or on Ctrl+C. ValdradaUE.bat next
# to the package root runs this script with the arguments it was given; the options are those of ValdradaUE.sh:
#
#   ValdradaUE.bat
#   ValdradaUE.bat --res 1920x1080 --quality cinematic
#   ValdradaUE.bat --offscreen --gpu 1
#   ValdradaUE.bat --core-only --host 0.0.0.0
#   ValdradaUE.bat --renderer-only --core-host 10.0.0.5
#   ValdradaUE.bat -- -ExecCmds="stat fps"
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Core = Join-Path $Root 'core'
$Renderer = Join-Path $Root 'renderer'
$o = @{ port = '2000'; host = '127.0.0.1'; corehost = '127.0.0.1'; res = '1280x720'; quality = 'high'; offscreen = $false;
        fullscreen = $false; gpu = ''; time = 'day'; lat = '40.80955'; lon = '-73.95905'; seed = '1'; peds = 'photoreal';
        mode = 'both'; logdir = (Join-Path $Root 'logs'); verbose = $false }
$extra = @()
$argv = @($args)
function Fail($msg) { Write-Host "ValdradaUE: $msg" -ForegroundColor Red; exit 2 }
function Next { $script:i++; if ($script:i -ge $argv.Count) { Fail "$($argv[$script:i - 1]) needs a value" }; return [string]$argv[$script:i] }
$help = @'
Options (as ValdradaUE.sh):
  --port N              the API port (default 2000); the renderer connects to the same port
  --host ADDR           the address the core listens on (default 127.0.0.1)
  --core-host ADDR      with --renderer-only: the core to connect to (default 127.0.0.1)
  --res WxH             the window and the default RGB camera size (default 1280x720)
  --quality Q           low, medium, high (default) or cinematic
  --offscreen           render without a window
  --fullscreen          a full screen window instead of a framed one
  --gpu N               the GPU the renderer uses (0 = the first)
  --time T              day (default), golden, dusk or night
  --start-lat L --start-lon L   where the city streams in first
  --seed N              the simulation's random seed (default 1)
  --pedestrians P       photoreal (default) or procedural
  --core-only           start only the core
  --renderer-only       start only the renderer
  --log-dir DIR         where core.log and renderer.log go (default logs\ in the package)
  --verbose             log every API request in core.log
  --                    the arguments after it go to Unreal unchanged
'@
for ($script:i = 0; $script:i -lt $argv.Count; $script:i++) {
  $a = [string]$argv[$script:i]
  switch -exact ($a) {
    '--port' { $o.port = Next } '--host' { $o.host = Next } '--core-host' { $o.corehost = Next }
    '--res' { $o.res = Next } '--quality' { $o.quality = Next } '--offscreen' { $o.offscreen = $true }
    '--fullscreen' { $o.fullscreen = $true } '--gpu' { $o.gpu = Next } '--time' { $o.time = Next }
    '--start-lat' { $o.lat = Next } '--start-lon' { $o.lon = Next } '--seed' { $o.seed = Next }
    '--pedestrians' { $o.peds = Next } '--core-only' { $o.mode = 'core' } '--renderer-only' { $o.mode = 'renderer' }
    '--log-dir' { $o.logdir = Next } '--verbose' { $o.verbose = $true }
    '-h' { Write-Host $help; exit 0 } '--help' { Write-Host $help; exit 0 }
    '--' { if ($script:i + 1 -lt $argv.Count) { $extra = $argv[($script:i + 1)..($argv.Count - 1)] }; $script:i = $argv.Count }
    default { Fail "unknown option $a (--help lists them)" }
  }
}
if ($o.port -notmatch '^\d+$') { Fail '--port must be a number' }
if ($o.res -notmatch '^\d+x\d+$') { Fail '--res must be WxH, e.g. 1280x720' }
$tiers = @{ low = @('low', 'medium'); medium = @('medium', 'medium'); high = @('high', 'high'); cinematic = @('cinematic', 'high') }
if (-not $tiers.ContainsKey($o.quality)) { Fail '--quality is low, medium, high or cinematic' }
$tier, $coreQ = $tiers[$o.quality]
New-Item -ItemType Directory -Force -Path $o.logdir | Out-Null
function Say($m) { Write-Host ("[ValdradaUE {0}] {1}" -f (Get-Date -Format HH:mm:ss), $m) }
# arguments for Start-Process: quote what has spaces
function Q($s) { if ($s -match '[\s"]') { '"' + ($s -replace '"', '\"') + '"' } else { $s } }

$coreProc = $null; $rendProc = $null
function Stop-Both {
  foreach ($p in @(@($script:rendProc, 'renderer', 15), @($script:coreProc, 'core', 5))) {
    $proc, $name, $grace = $p
    if ($proc -and -not $proc.HasExited) {
      # the renderer gets a close request first (WM_CLOSE: Unreal saves and exits); the core has no window: terminated
      if ($name -eq 'renderer') { [void]$proc.CloseMainWindow() }
      if (-not $proc.WaitForExit($grace * 1000)) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; Say "$name did not stop in $grace s: killed" }
      else { Say "$name stopped" }
    }
  }
}

try {
  if ($o.mode -ne 'renderer') {
    $node = Join-Path $Core 'node\node.exe'
    if (-not (Test-Path $node)) { Fail "no core at $Core (download the core archive: python fetch_valdrada_ue.py)" }
    if (-not (Test-Path (Join-Path $Core 'app\client\public\tiles'))) { Fail "the city's tiles are missing in $Core\app\client\public\tiles" }
    $log = Join-Path $o.logdir 'core.log'; Set-Content -Path $log -Value $null
    $env:VALDRADA_CELLCACHE = Join-Path $Core 'app\cellcache'
    # the city's ground as the renderer's blocks have it (the terrain cell list ships with the core; without it, flat)
    $cells = Join-Path $Core 'app\client\public\data\terrain_cells.json'
    if (Test-Path $cells) { $env:TERRAIN_P1 = '1'; $env:HHP_P2 = '1'; $env:TERRAIN_P1_CELLS = $cells }
    $tc = Join-Path $Core 'app\cache\tiles'
    if (Test-Path $tc) { $env:VALDRADA_TILE_CACHE = $tc }
    $env:ELECTRON_RUN_AS_NODE = $null
    $a = @((Q (Join-Path $Core 'app\tools\core\serve.mjs')), '--port', $o.port, '--host', $o.host, '--res', $o.res, '--quality', $coreQ,
           '--time', $o.time, '--start-lat', $o.lat, '--start-lon', $o.lon, '--seed', $o.seed, '--pedestrians', $o.peds, '--log', (Q $log))
    if ($o.verbose) { $a += '--verbose' }
    $coreProc = Start-Process -FilePath $node -ArgumentList $a -NoNewWindow -PassThru `
      -RedirectStandardOutput (Join-Path $o.logdir 'core.out') -RedirectStandardError (Join-Path $o.logdir 'core.err')
    Say "core starting (pid $($coreProc.Id), $($o.host):$($o.port), log $log)"
    $deadline = (Get-Date).AddSeconds(120)
    while ($true) {
      if ($coreProc.HasExited) { Get-Content (Join-Path $o.logdir 'core.out') -Tail 20; Fail 'the core exited during start' }
      $t = Get-Content $log -Raw -ErrorAction SilentlyContinue
      if ($t -match 'ERROR cannot listen') { Fail "port $($o.port) is in use (another server running? use --port)" }
      if ($t -match 'world ready in ([\d.]+) s') { Say "core ready: world ready in $($Matches[1]) s"; break }
      if ((Get-Date) -gt $deadline) { Fail 'the core did not get ready in 120 s (see core.log)' }
      Start-Sleep -Milliseconds 100
    }
  }
  if ($o.mode -ne 'core') {
    # the game binary itself (the ValdradaUE.exe at the renderer's root only starts it and waits), so that the close request
    # reaches its window
    $exe = Get-ChildItem -Path (Join-Path $Renderer 'ValdradaUE\Binaries\Win64') -Filter 'ValdradaUE*.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $exe) { $exe = Get-ChildItem -Path $Renderer -Filter 'ValdradaUE.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if (-not $exe) { Fail "no renderer at $Renderer (download the renderer archive and the content: python fetch_valdrada_ue.py)" }
    $w, $h = $o.res -split 'x'
    $host_ = if ($o.mode -eq 'both') { if ($o.host -in '127.0.0.1', '0.0.0.0') { '127.0.0.1' } else { $o.host } } else { $o.corehost }
    $a = @("-ValdradaHost=$host_", "-ValdradaPort=$($o.port)", "-ValdradaTier=$tier", "-ResX=$w", "-ResY=$h",
           ('-abslog=' + (Q (Join-Path $o.logdir 'renderer.log'))), '-nosplash', '-nosound', '-unattended')
    if (Test-Path (Join-Path $Renderer 'ValdradaUE\Data\tables')) { $a += '-ValdradaTables=Data/tables' }
    if ($o.offscreen) { $a += '-RenderOffScreen' } elseif ($o.fullscreen) { $a += '-fullscreen' } else { $a += '-windowed' }
    if ($o.gpu -ne '') { $a += "-graphicsadapter=$($o.gpu)" }
    $a += @($extra | ForEach-Object { Q ([string]$_) })
    $rendProc = Start-Process -FilePath $exe.FullName -ArgumentList $a -PassThru
    Say "renderer started (pid $($rendProc.Id), tier $tier, ${w}x${h}$(if ($o.offscreen) { ', off screen' }))"
  }
  if ($o.mode -ne 'renderer') { Say "connect with: import valdrada; client = valdrada.Client(""localhost"", $($o.port))" }
  Say 'Ctrl+C stops it'
  while ($true) {
    if ($coreProc -and $coreProc.HasExited) { Say "the core exited (code $($coreProc.ExitCode))"; break }
    if ($rendProc -and $rendProc.HasExited) { Say "the renderer exited (code $($rendProc.ExitCode))"; break }
    Start-Sleep -Milliseconds 500
  }
} finally {
  Stop-Both
}
