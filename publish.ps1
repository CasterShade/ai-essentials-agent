<#
  publish.ps1 -- commit + push the agent embed layer and switch GitHub Pages to the validated workflow deploy.
  Run from this folder in PowerShell:   .\publish.ps1
#>
$ErrorActionPreference = 'Continue'   # PS 5.1: git/az write progress to stderr; exit codes are checked explicitly
$Owner = 'CasterShade'; $Repo = 'ai-essentials-agent'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$patPath = Join-Path (Split-Path -Parent $here) 'PAT.txt'
if (-not (Test-Path $patPath)) { throw "PAT.txt not found at $patPath" }
$pat = (Get-Content $patPath -Raw).Trim()
$H = @{ Authorization = "Bearer $pat"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'agent-embed-publish' }

Write-Host "== workflow file"
New-Item -ItemType Directory -Force -Path (Join-Path $here '.github\workflows') | Out-Null
Copy-Item (Join-Path $here 'scripts\github-workflow-deploy.yml') (Join-Path $here '.github\workflows\deploy.yml') -Force
Write-Host "   .github\workflows\deploy.yml installed"

Write-Host "== git"
if (-not (git config user.email)) { git config user.email 'ai.zubair.khan.us@gmail.com'; git config user.name 'Zubair Khan' }
git add -A
$msg = if ($args.Count -gt 0) { [string]$args[0] } else { "Embed layer: registry-driven agents, lesson contexts + activity bar + client tools, Cohort Hub door (hub.html)" }
git -c core.autocrlf=false commit -q -m $msg 2>$null | Out-Null
$remote = "https://x-access-token:$pat@github.com/$Owner/$Repo.git"
git remote set-url origin $remote
git push -u origin main
if ($LASTEXITCODE -ne 0) { git remote set-url origin "https://github.com/$Owner/$Repo.git"; throw 'git push failed (see output above). If it mentions workflow scope, add the workflow scope to the PAT.' }
git remote set-url origin "https://github.com/$Owner/$Repo.git"
Write-Host "   pushed main"

Write-Host "== GitHub Pages -> build from the workflow (validate + smoke test before every deploy)"
try {
  Invoke-RestMethod -Headers $H -Method Put -Body '{"build_type":"workflow"}' -ContentType 'application/json' "https://api.github.com/repos/$Owner/$Repo/pages" | Out-Null
} catch {
  try { Invoke-RestMethod -Headers $H -Method Post -Body '{"build_type":"workflow"}' -ContentType 'application/json' "https://api.github.com/repos/$Owner/$Repo/pages" | Out-Null } catch { Write-Host "   could not switch Pages source automatically: set Settings > Pages > Source = GitHub Actions" }
}
Write-Host "   done. Watch https://github.com/$Owner/$Repo/actions -- live in ~2 min at https://castershade.github.io/ai-essentials-agent/builder.html"
