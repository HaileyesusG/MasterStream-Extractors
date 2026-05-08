# Update-Manifest.ps1
# Run this after editing any extractor JS file.
# It re-hashes all extractors and updates manifest.json automatically.

$manifestPath = Join-Path $PSScriptRoot "manifest.json"
$extractorsDir = Join-Path $PSScriptRoot "extractors"

$manifest = Get-Content $manifestPath | ConvertFrom-Json
$manifest.version = $manifest.version + 1

foreach ($provider in $manifest.providers.PSObject.Properties) {
    $file = $provider.Value.file
    $fullPath = Join-Path $PSScriptRoot $file
    if (Test-Path $fullPath) {
        $hash = (Get-FileHash $fullPath -Algorithm MD5).Hash
        $provider.Value.hash = $hash
        Write-Host "✅ $($provider.Name): $hash"
    } else {
        Write-Warning "❌ File not found: $fullPath"
    }
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content $manifestPath
Write-Host ""
Write-Host "📋 manifest.json updated to version $($manifest.version)"
Write-Host "Run: git add . && git commit -m 'Update extractors v$($manifest.version)' && git push"
