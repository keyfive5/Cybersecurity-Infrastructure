# Builds the Keyward Vault installer with the .NET Framework C# compiler that ships
# in Windows (no SDK needed), then stages the downloadable setup folder + zip.
$ErrorActionPreference = "Stop"
$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$src    = Join-Path $here "src"
$build  = Join-Path $here "build"
$dist   = Join-Path $here "dist"
$csc    = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe" }

New-Item -ItemType Directory -Force -Path $build | Out-Null
Get-ChildItem $build -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

$common   = Join-Path $src "Common.cs"
$manifest = Join-Path $src "app.manifest"

function Compile($outName, $target, $files, $refs, $useManifest) {
    $out = Join-Path $build $outName
    $args = @("/nologo", "/target:$target", "/out:$out", "/optimize+")
    foreach ($r in $refs) { $args += "/reference:$r" }
    if ($useManifest) { $args += "/win32manifest:$manifest" }
    foreach ($f in $files) { $args += $f }
    Write-Host "Compiling $outName ..." -ForegroundColor Cyan
    & $csc @args
    if ($LASTEXITCODE -ne 0) { throw "csc failed for $outName (exit $LASTEXITCODE)" }
}

$winRefs = @("System.dll","System.Core.dll","System.Xml.dll","System.Security.dll",
             "System.Windows.Forms.dll","System.Drawing.dll","System.ServiceProcess.dll")

# 1) the Vault service (console-subsystem exe so it can also run with --console)
Compile "KeywardVault.exe" "exe" @($common, (Join-Path $src "VaultService.cs")) `
        @("System.dll","System.Core.dll","System.Xml.dll","System.Security.dll","System.ServiceProcess.dll") $false

# 2) the admin console (needs admin to control the service)
Compile "KeywardServerAdmin.exe" "winexe" @($common, (Join-Path $src "ServerAdmin.cs")) $winRefs $true

# 3) the wizard
Compile "Setup.exe" "winexe" @($common, (Join-Path $src "Setup.cs")) $winRefs $true

# ---- stage the downloadable setup folder ----
$stageName = "KeywardVault-Setup"
$stage = Join-Path $dist $stageName
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "Server") | Out-Null

Copy-Item (Join-Path $build "Setup.exe") $stage
Copy-Item (Join-Path $build "KeywardVault.exe") (Join-Path $stage "Server")
Copy-Item (Join-Path $build "KeywardServerAdmin.exe") (Join-Path $stage "Server")
Copy-Item (Join-Path (Split-Path $here -Parent) "LICENSE") (Join-Path $stage "LICENSE.txt") -ErrorAction SilentlyContinue

$readme = @"
Keyward Vault - Setup
=====================

1. Copy this whole folder onto your Vault VM (or cloud Windows instance).
2. Right-click Setup.exe and choose "Run as administrator".
   (If Windows SmartScreen warns, click "More info" then "Run anyway" - it is
    unsigned because it is your own lab build.)
3. Follow the wizard. Accept the defaults for a standalone lab install, and set
   a Master and Administrator password at the end.
4. When it finishes, open "Keyward Server Central Administration" (in the install
   folder, Server\KeywardServerAdmin.exe) to watch the Vault run.

Silent install (optional, from an elevated Command Prompt):
   Setup.exe --silent name="Hasan" company="Keyward Lab" master="Str0ng!" admin="Str0ng!"

Uninstall:
   Setup.exe --uninstall

Built by M. Hasan Zafar.
"@
Set-Content -Path (Join-Path $stage "README.txt") -Value $readme -Encoding UTF8

$zip = Join-Path $dist "KeywardVault-Setup.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $stage -DestinationPath $zip
Write-Host ""
Write-Host "Built:" -ForegroundColor Green
Get-ChildItem $build | Select-Object Name,Length | Format-Table -AutoSize
Write-Host "Packaged: $zip" -ForegroundColor Green
