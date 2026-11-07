$root = $env:CLAUDE_PROJECT_DIR
if (-not $root) { $root = (Get-Location).Path }
Set-Location $root

$log = Join-Path $root ".claude\auto-commit.log"
function Log($m) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m) }

$branch = (git branch --show-current 2>$null)
if ($branch -ne "auto-save") { Log "skip: current branch is '$branch'"; exit 0 }

git add -A 2>&1 | Out-Null
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Log "no changes"; exit 0 }

$msg = "auto: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
git commit -q -m $msg 2>&1 | ForEach-Object { Log $_ }
git push -q origin auto-save 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log "push failed" } else { Log "pushed: $msg" }
exit 0
