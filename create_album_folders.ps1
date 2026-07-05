#Requires -Version 5.1
param(
    [Parameter(Mandatory = $true)]
    [string]$BaseDir,

    [Parameter(Mandatory = $true)]
    [string]$MarkdownFile
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

if (-not (Test-Path -LiteralPath $MarkdownFile)) {
    Write-Error "마크다운 파일을 찾을 수 없습니다: $MarkdownFile"
    exit 1
}

if (-not (Test-Path -LiteralPath $BaseDir)) {
    New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
}

$created = 0
$existing = 0
$skipped = 0

Get-Content -LiteralPath $MarkdownFile -Encoding UTF8 | ForEach-Object {
    $line = $_
    if ($line -notmatch '^\|\s*(.+?)\s*\|\s*(\d{8})\s*\|') {
        return
    }

    $title = $Matches[1].Trim().Trim('*')
    $date = $Matches[2]

    if ($title -eq '제목' -or $title -match '^-+$' -or [string]::IsNullOrWhiteSpace($title)) {
        $script:skipped++
        return
    }

    $safeTitle = $title
    foreach ($ch in [System.IO.Path]::GetInvalidFileNameChars()) {
        $safeTitle = $safeTitle.Replace([string]$ch, '')
    }
    $safeTitle = $safeTitle.Trim()
    if ([string]::IsNullOrWhiteSpace($safeTitle)) {
        $script:skipped++
        return
    }

    $year = $date.Substring(0, 4)
    $folderName = "${date}_${safeTitle}"
    $yearPath = Join-Path $BaseDir $year
    $fullPath = Join-Path $yearPath $folderName

    if (-not (Test-Path -LiteralPath $yearPath)) {
        New-Item -ItemType Directory -Path $yearPath -Force | Out-Null
    }

    if (Test-Path -LiteralPath $fullPath) {
        $script:existing++
        Write-Host "[기존] $year\$folderName"
    }
    else {
        New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
        $script:created++
        Write-Host "[생성] $year\$folderName"
    }
}

Write-Host ""
Write-Host "완료 - 생성: $created, 기존: $existing, 건너뜀: $skipped"
exit 0
