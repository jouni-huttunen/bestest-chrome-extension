# Builds release/, the production release: a clean copy of only the files
# Chrome loads. Run only when the owner asks for a new release (SPEC.md 9.1).
$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$release = Join-Path $root "release"
$items = @("manifest.json", "background.js", "popup", "features")

# Empty the folder instead of deleting it, so the path Chrome has loaded stays put.
if (Test-Path $release) {
  Get-ChildItem -Path $release -Force | Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $release | Out-Null
}

foreach ($item in $items) {
  Copy-Item -Path (Join-Path $root $item) -Destination $release -Recurse
}

$version = (Get-Content (Join-Path $release "manifest.json") -Raw | ConvertFrom-Json).version
$count = (Get-ChildItem -Path $release -Recurse -File).Count
Write-Output "Built release/ (version $version, $count files)."
