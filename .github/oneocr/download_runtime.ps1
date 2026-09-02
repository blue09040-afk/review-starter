[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutDir,
    [ValidateSet('fast-mirror')]
    [string]$Mode,
    [string]$ProvenancePath,
    [switch]$ValidateConfigOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-OneOcrSourceConfig {
    $configPath = Join-Path $PSScriptRoot 'RUNTIME_SOURCE.txt'
    if (!(Test-Path -LiteralPath $configPath -PathType Leaf)) {
        throw "OneOCR runtime source config is missing: $configPath"
    }

    $config = @{}
    foreach ($rawLine in Get-Content -LiteralPath $configPath -Encoding utf8) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }
        $parts = $line -split ':', 2
        if ($parts.Count -ne 2) { continue }
        $key = $parts[0].Trim()
        $value = $parts[1].Trim()
        if ($config.ContainsKey($key)) { throw "Duplicate OneOCR source config key: $key" }
        $config[$key] = $value
    }
    return $config
}

$sourceConfig = Read-OneOcrSourceConfig
$requiredConfigKeys = @(
    'default-acquisition-mode',
    'supported-acquisition-modes',
    'mirror-repository',
    'mirror-commit',
    'mirror-path',
    'mirror-archive-sha256',
    'mirror-oneocr-dll-sha256',
    'mirror-oneocr-onemodel-sha256',
    'mirror-onnxruntime-dll-sha256',
    'mirror-runtime-version',
    'official-fallback-product-id',
    'official-fallback-resolver'
)
foreach ($key in $requiredConfigKeys) {
    if (-not $sourceConfig.ContainsKey($key) -or [string]::IsNullOrWhiteSpace([string]$sourceConfig[$key])) {
        throw "Required OneOCR source config key is missing: $key"
    }
}

$defaultMode = [string]$sourceConfig['default-acquisition-mode']
$supportedModes = @(([string]$sourceConfig['supported-acquisition-modes']) -split ',' | ForEach-Object { $_.Trim() })
if ($defaultMode -ne 'fast-mirror') {
    throw 'default-acquisition-mode must be fast-mirror'
}
if ($supportedModes.Count -ne 1 -or $supportedModes[0] -ne 'fast-mirror') {
    throw 'supported-acquisition-modes must contain only fast-mirror'
}
if ([string]::IsNullOrWhiteSpace($Mode)) {
    $Mode = $defaultMode
}

$mirrorRepository = [string]$sourceConfig['mirror-repository']
$mirrorCommit = [string]$sourceConfig['mirror-commit']
$mirrorPathInRepo = [string]$sourceConfig['mirror-path']
$mirrorSha256 = ([string]$sourceConfig['mirror-archive-sha256']).ToLowerInvariant()
$runtimeVersion = [string]$sourceConfig['mirror-runtime-version']
$mirrorFileSha256 = @{
    'oneocr.dll' = ([string]$sourceConfig['mirror-oneocr-dll-sha256']).ToLowerInvariant()
    'oneocr.onemodel' = ([string]$sourceConfig['mirror-oneocr-onemodel-sha256']).ToLowerInvariant()
    'onnxruntime.dll' = ([string]$sourceConfig['mirror-onnxruntime-dll-sha256']).ToLowerInvariant()
}
$productId = [string]$sourceConfig['official-fallback-product-id']
$resolverUrl = [string]$sourceConfig['official-fallback-resolver']

if ($mirrorRepository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Invalid mirror-repository in RUNTIME_SOURCE.txt'
}
if ($mirrorCommit -notmatch '^[0-9a-fA-F]{40}$') {
    throw 'mirror-commit must be a full 40-character Git commit SHA'
}
if ($mirrorPathInRepo -notmatch '^[A-Za-z0-9._/-]+$' -or
    $mirrorPathInRepo.StartsWith('/') -or
    ($mirrorPathInRepo -split '/') -contains '..') {
    throw 'Invalid mirror-path in RUNTIME_SOURCE.txt'
}
if ($mirrorSha256 -notmatch '^[0-9a-f]{64}$') {
    throw 'mirror-archive-sha256 must be a 64-character hexadecimal SHA-256'
}
foreach ($entry in $mirrorFileSha256.GetEnumerator()) {
    if ($entry.Value -notmatch '^[0-9a-f]{64}$') {
        throw "Pinned mirror file hash must be a 64-character hexadecimal SHA-256: $($entry.Key)"
    }
}
if ($runtimeVersion -notmatch '^SnippingToolApp_[0-9.]+_x64$') {
    throw 'mirror-runtime-version must identify a pinned x64 Snipping Tool runtime'
}
if ($productId -notmatch '^[A-Za-z0-9]+$') {
    throw 'Invalid official-fallback-product-id in RUNTIME_SOURCE.txt'
}
$resolverUri = [uri]$resolverUrl
if ($resolverUri.Scheme -ne 'https' -or $resolverUri.DnsSafeHost -ne 'store.rg-adguard.net') {
    throw 'official-fallback-resolver must be the expected HTTPS store.rg-adguard.net endpoint'
}

$productUrl = "https://apps.microsoft.com/detail/$productId"
$mirrorUrl = "https://raw.githubusercontent.com/$mirrorRepository/$mirrorCommit/$mirrorPathInRepo"
$resolverHeaders = @{
    'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    'Origin' = 'https://store.rg-adguard.net'
    'Referer' = 'https://store.rg-adguard.net/'
}
$required = @('oneocr.dll', 'oneocr.onemodel', 'onnxruntime.dll')
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("oneocr-runtime-" + [guid]::NewGuid().ToString('N'))
$mirrorPath = Join-Path $tempRoot 'OneOCR.zip'
$bundlePath = Join-Path $tempRoot 'Microsoft.ScreenSketch.msixbundle'
$innerPath = Join-Path $tempRoot 'Microsoft.ScreenSketch-x64.msix'

if ($ValidateConfigOnly) {
    Write-Host "OneOCR source config validated. DefaultMode=$defaultMode Mirror=$mirrorRepository@$mirrorCommit Path=$mirrorPathInRepo"
    $global:LASTEXITCODE = 0
    return
}

function Test-MicrosoftDownloadUri {
    param([uri]$Uri)
    if ($Uri.Scheme -ne 'https') { return $false }
    $hostName = $Uri.DnsSafeHost.ToLowerInvariant()
    return $hostName -eq 'microsoft.com' -or
        $hostName.EndsWith('.microsoft.com') -or
        $hostName -eq 'windowsupdate.com' -or
        $hostName.EndsWith('.windowsupdate.com')
}

function Assert-MicrosoftSignature {
    param([string]$Path)

    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid -and
        $signature.SignerCertificate -and
        $signature.SignerCertificate.Subject -match 'Microsoft Corporation') {
        Write-Host "Microsoft Authenticode signature verified: $([System.IO.Path]::GetFileName($Path))"
        return
    }

    $kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    $signTool = Get-ChildItem -LiteralPath $kitsRoot -Filter signtool.exe -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if (-not $signTool) {
        throw "Microsoft signature could not be verified and signtool.exe was not found. Status=$($signature.Status)"
    }

    $verification = & $signTool.FullName verify /pa /all /v $Path 2>&1
    if ($LASTEXITCODE -ne 0 -or (($verification | Out-String) -notmatch 'Microsoft Corporation')) {
        throw "File did not pass Microsoft signature verification: $Path"
    }
    Write-Host "Microsoft signature verified with signtool: $([System.IO.Path]::GetFileName($Path))"
}

function Expand-RequiredOneOcrFiles {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ArchivePath,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($name in $script:required) {
            $matches = @($archive.Entries | Where-Object { $_.Name -ieq $name })
            if ($matches.Count -ne 1) {
                throw "Expected exactly one $name in the archive; found $($matches.Count)."
            }
            $target = Join-Path $Destination $name
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($matches[0], $target, $true)
            if ((Get-Item -LiteralPath $target).Length -le 0) {
                throw "Extracted runtime file is empty: $name"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Assert-PinnedMirrorRuntime {
    param([string]$Destination)

    foreach ($name in $script:required) {
        $path = Join-Path $Destination $name
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        $expected = $script:mirrorFileSha256[$name]
        if ($actual -ne $expected) {
            throw "Pinned mirror file SHA-256 mismatch. File=$name Expected=$expected Actual=$actual"
        }
    }

    foreach ($name in @('oneocr.dll', 'onnxruntime.dll')) {
        Assert-MicrosoftSignature -Path (Join-Path $Destination $name)
    }
    Write-Host "Pinned OneOCR runtime verified. Version=$($script:runtimeVersion)"
}

function Try-PinnedMirrorRuntime {
    param([string]$Destination)

    if ($env:ONEOCR_SKIP_MIRROR -eq '1') {
        Write-Host 'ONEOCR_SKIP_MIRROR=1; skipping the pinned third-party mirror.'
        return $false
    }

    try {
        Write-Host 'Trying pinned OneOCR mirror archive.'
        Invoke-WebRequest -Uri $script:mirrorUrl -OutFile $script:mirrorPath
        $actualSha256 = (Get-FileHash -LiteralPath $script:mirrorPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualSha256 -ne $script:mirrorSha256) {
            throw "Pinned mirror SHA-256 mismatch. Expected=$($script:mirrorSha256) Actual=$actualSha256"
        }

        Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
        Expand-RequiredOneOcrFiles -ArchivePath $script:mirrorPath -Destination $Destination
        Assert-PinnedMirrorRuntime -Destination $Destination
        Write-Host 'Pinned OneOCR mirror archive, runtime hashes, and Microsoft DLL signatures verified.'
        return $true
    }
    catch {
        Write-Warning "Pinned OneOCR mirror unavailable or invalid. $($_.Exception.Message)"
        Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
        return $false
    }
}

function Expand-VerifiedMicrosoftBundle {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Bundle,
        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    Assert-MicrosoftSignature -Path $Bundle
    $bundleArchive = [System.IO.Compression.ZipFile]::OpenRead($Bundle)
    try {
        $manifestEntry = $bundleArchive.Entries | Where-Object { $_.FullName -ieq 'AppxMetadata/AppxBundleManifest.xml' } | Select-Object -First 1
        if (-not $manifestEntry) { throw 'Appx bundle manifest is missing.' }
        $reader = [System.IO.StreamReader]::new($manifestEntry.Open())
        try { $manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($manifest -notmatch 'Name="Microsoft\.ScreenSketch' -or $manifest -notmatch 'Publisher="[^"]*Microsoft') {
            throw 'Downloaded bundle identity is not Microsoft.ScreenSketch.'
        }

        $innerEntry = $bundleArchive.Entries |
            Where-Object { $_.Name -match '_x64_.*\.msix$' } |
            Sort-Object Length -Descending |
            Select-Object -First 1
        if (-not $innerEntry) { throw 'The x64 Snipping Tool MSIX package is missing from the bundle.' }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($innerEntry, $script:innerPath, $true)
    }
    finally {
        $bundleArchive.Dispose()
    }

    Remove-Item -LiteralPath $Destination -Recurse -Force -ErrorAction SilentlyContinue
    Expand-RequiredOneOcrFiles -ArchivePath $script:innerPath -Destination $Destination
    foreach ($name in @('oneocr.dll', 'onnxruntime.dll')) {
        Assert-MicrosoftSignature -Path (Join-Path $Destination $name)
    }
    Write-Host 'Extracted and verified the three required OneOCR runtime files from the Microsoft package.'
}

function Get-VerifiedMicrosoftResolverRuntime {
    param([string]$Destination)

    Write-Host 'Trying the verified Microsoft CDN resolver path.'
    $response = Invoke-WebRequest -Uri $script:resolverUrl -Method Post -Headers $script:resolverHeaders -ContentType 'application/x-www-form-urlencoded' -Body @{
        type = 'url'
        url = $script:productUrl
        ring = 'Retail'
        lang = 'en-US'
    }

    $pattern = '<a[^>]+href="(?<url>[^"]+)"[^>]*>(?<name>Microsoft\.ScreenSketch_[^<]+\.msixbundle)</a>'
    $candidates = [regex]::Matches($response.Content, $pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) |
        ForEach-Object {
            $name = [System.Net.WebUtility]::HtmlDecode($_.Groups['name'].Value)
            $url = [System.Net.WebUtility]::HtmlDecode($_.Groups['url'].Value)
            $versionText = ([regex]::Match($name, 'Microsoft\.ScreenSketch_(?<version>[0-9.]+)_')).Groups['version'].Value
            if ($versionText) {
                [pscustomobject]@{
                    Name = $name
                    Uri = [uri]$url
                    Version = [version]$versionText
                }
            }
        } |
        Where-Object { Test-MicrosoftDownloadUri $_.Uri } |
        Sort-Object Version -Descending

    $selected = $candidates | Select-Object -First 1
    if (-not $selected) {
        throw 'No HTTPS Microsoft-hosted Snipping Tool MSIX bundle was returned by the resolver.'
    }

    Write-Host "Downloading Microsoft.ScreenSketch bundle version $($selected.Version)."
    Invoke-WebRequest -Uri $selected.Uri -OutFile $script:bundlePath
    Expand-VerifiedMicrosoftBundle -Bundle $script:bundlePath -Destination $Destination
}

function Write-AcquisitionProvenance {
    param([string]$Source)

    if ([string]::IsNullOrWhiteSpace($ProvenancePath)) { return }
    $parent = Split-Path -Parent $ProvenancePath
    if (-not [string]::IsNullOrWhiteSpace($parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    [ordered]@{
        schema = 1
        mode = $Mode
        source = $Source
        mirror_runtime_version = if ($Source -eq 'third-party-pinned-mirror') { $runtimeVersion } else { $null }
    } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $ProvenancePath -Encoding utf8
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    $attempts = @('mirror', 'resolver')

    foreach ($attempt in $attempts) {
        try {
            switch ($attempt) {
                'mirror' {
                    if (-not (Try-PinnedMirrorRuntime -Destination $OutDir)) { continue }
                    Write-AcquisitionProvenance -Source 'third-party-pinned-mirror'
                }
                'resolver' {
                    Get-VerifiedMicrosoftResolverRuntime -Destination $OutDir
                    Write-AcquisitionProvenance -Source 'microsoft-cdn-resolver'
                }
            }
            $global:LASTEXITCODE = 0
            return
        }
        catch {
            Write-Warning "OneOCR acquisition attempt failed. Mode=$Mode Attempt=$attempt Error=$($_.Exception.Message)"
            Remove-Item -LiteralPath $OutDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Warning "All permitted OneOCR acquisition attempts failed. Mode=$Mode"
    $global:LASTEXITCODE = 1
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
