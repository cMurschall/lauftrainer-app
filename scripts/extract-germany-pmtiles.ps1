# Extract a Germany PMTiles slice from the Protomaps daily build and print next steps for R2 upload.
# Requires: pmtiles CLI next to this script, or on PATH
#   https://github.com/protomaps/go-pmtiles/releases
#
# Usage:
#   .\scripts\extract-germany-pmtiles.ps1
#   .\scripts\extract-germany-pmtiles.ps1 -SourceDate 20260815 -MaxZoom 12

param(
  [string]$SourceDate = (Get-Date).ToString('yyyyMMdd'),
  [int]$MaxZoom = 12,
  [string]$OutFile = 'germany.pmtiles',
  # WGS84 bbox: west,south,east,north (Germany with small padding)
  [string]$Bbox = '5.8,47.2,15.1,55.1'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$localPmtiles = Join-Path $scriptDir 'pmtiles.exe'
$pmtilesCmd = $null

if (Test-Path -LiteralPath $localPmtiles) {
  $pmtilesCmd = $localPmtiles
} elseif (Get-Command pmtiles -ErrorAction SilentlyContinue) {
  $pmtilesCmd = 'pmtiles'
} else {
  Write-Error "pmtiles CLI not found. Place pmtiles.exe next to this script ($scriptDir) or add it to PATH. https://github.com/protomaps/go-pmtiles/releases"
}

# Resolve OutFile relative to the current working directory (usually repo root).
if (-not [System.IO.Path]::IsPathRooted($OutFile)) {
  $OutFile = Join-Path (Get-Location) $OutFile
}

$sourceUrl = "https://build.protomaps.com/$SourceDate.pmtiles"
Write-Host "Using: $pmtilesCmd"
Write-Host "Extracting Germany (maxzoom=$MaxZoom) from $sourceUrl ..."
& $pmtilesCmd extract $sourceUrl $OutFile --bbox=$Bbox --maxzoom=$MaxZoom

$sizeMb = [math]::Round((Get-Item -LiteralPath $OutFile).Length / 1MB, 1)
Write-Host "Wrote $OutFile ($sizeMb MB). Target: well under Cloudflare R2 free tier (10 GB)."
Write-Host ""
Write-Host "Next:"
Write-Host "  1. Upload to an R2 Standard bucket (not Infrequent Access)."
Write-Host "  2. Configure CORS for your Pages origin + http://localhost:5173 (GET/HEAD, Range, If-Match)."
Write-Host "  3. Set VITE_MAP_PMTILES_URL to the public object URL ending in /germany.pmtiles"
Write-Host "  4. Replace the object monthly (or weekly) - no Worker needed."
