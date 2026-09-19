<#
  set-hub-url.ps1 -- point the Cohort Hub door (hub.html) at the hosted hub. This is the "replace script":
  courses embed hub.html?hub=<key>, so this ONE edit moves every Cohort Hub block in every course.
  Nothing in Rise or Thinkific is touched again.

    .\scripts\set-hub-url.ps1 -Url https://cohort-hub.xyz.eastus.azurecontainerapps.io
    .\scripts\set-hub-url.ps1 -Url https://hub.yu.edu -Hub chah-2026        # the hub moved hosts
    .\scripts\set-hub-url.ps1 -Status paused                                # maintenance note
    .\scripts\set-hub-url.ps1 -Status pending                               # back to the placeholder
    add -SkipCheck to skip the /healthz probe, -Publish to run publish.ps1 afterwards

  Works on Windows PowerShell 5.1 and PowerShell 7. No Node needed.
#>
param(
  [string]$Url = '',
  [string]$Hub = 'chah-2026',
  [ValidateSet('active', 'pending', 'paused', '')][string]$Status = '',
  [switch]$SkipCheck,
  [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$file = Join-Path $repo 'hubs.json'
if (-not (Test-Path $file)) { throw "hubs.json not found at $file" }
if (-not $Status) { if ($Url) { $Status = 'active' } else { throw 'Give -Url https://... (sets the hub active) or -Status pending|paused.' } }

$cfg = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
$h = $cfg.hubs.$Hub
if ($null -eq $h) { throw "hubs.json has no hub '$Hub'. Known: $(($cfg.hubs.PSObject.Properties.Name) -join ', ')" }

if ($Status -eq 'active') {
  if (-not $Url) { $Url = [string]$h.baseUrl }
  $Url = $Url.Trim().TrimEnd('/')
  if ($Url -notmatch '^https://[A-Za-z0-9.-]+(:\d+)?$') { throw "'$Url' is not a bare https://host URL (no path). Example: https://cohort-hub.xyz.eastus.azurecontainerapps.io" }
  if (-not $SkipCheck) {
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $r = Invoke-WebRequest -Uri "$Url/healthz" -UseBasicParsing -TimeoutSec 20
      Write-Host "OK   $Url/healthz answered $($r.StatusCode)"
      $e = Invoke-WebRequest -Uri "$Url/embed?cohort=$($h.cohort)" -UseBasicParsing -TimeoutSec 20
      $csp = [string]$e.Headers['Content-Security-Policy']
      if ($csp -match 'frame-ancestors([^;]*)') {
        $fa = $Matches[1].Trim()
        if ($fa -notmatch 'thinkific') { Write-Warning "frame-ancestors is '$fa' -- it does not mention thinkific, so the block may be blank inside the course. Fix FRAME_ANCESTORS on the hub first." }
        else { Write-Host "OK   frame-ancestors allows: $fa" }
      } else { Write-Warning 'The hub sent no frame-ancestors policy -- fine for embedding, but check X-Frame-Options is not set.' }
    } catch {
      throw "The hub did not answer at $Url/healthz ($($_.Exception.Message)). Nothing was changed. Use -SkipCheck to set it anyway."
    }
  }
  $h.baseUrl = $Url
}
$h.status = $Status
$cfg.updated = (Get-Date).ToString('yyyy-MM-dd')

# UTF-8 WITHOUT a BOM: the CI validator reads this file with JSON.parse, which rejects a BOM.
$json = $cfg | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($file, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
# read it back so a bad write is caught here, not in CI
$check = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json
if ($check.hubs.$Hub.status -ne $Status) { throw 'hubs.json did not round-trip -- restore it with: git checkout -- hubs.json' }
$suffix = ''
if ($Status -eq 'active') { $suffix = " -> $($h.baseUrl)" }
Write-Host "hubs.json: '$Hub' is now $Status$suffix"

if ($Publish) { & (Join-Path $repo 'publish.ps1') }
else { Write-Host 'Next: run .\publish.ps1 -- every Cohort Hub block in every course follows within ~10 minutes.' }
