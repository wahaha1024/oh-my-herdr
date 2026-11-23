# Oh My Herdr 安装器（PowerShell 5.1，无新增运行时依赖）。
param(
  [string]$Source = "",
  [string]$Target = "",
  [switch]$Force,
  [switch]$DryRun,
  [switch]$Uninstall,
  [string]$Restore = ""
)
$ErrorActionPreference = "Stop"
$src = if ($Source) { [System.IO.Path]::GetFullPath($Source) } else { [System.IO.Path]::GetFullPath($PSScriptRoot) }
if (-not (Test-Path -LiteralPath $src -PathType Container)) { throw "安装包目录不存在：$src" }

if ($Uninstall -and $Restore) { throw "-Uninstall 与 -Restore 不能同时使用。" }
if (-not $Target) {
  if ($env:HERDR_APP_HOME) { $Target = $env:HERDR_APP_HOME }
  elseif ($env:XDG_CONFIG_HOME) { $Target = Join-Path $env:XDG_CONFIG_HOME "herdr-app" }
  elseif ($env:HERDR_CONFIG) { $Target = $env:HERDR_CONFIG }
  else { $Target = Join-Path $HOME ".config\herdr-app" }
}
$Target = [System.IO.Path]::GetFullPath($Target)

function Read-Json($path, $label) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  if (($label -eq "源 programs.json" -or $label -eq "目标 programs.json") -and -not $raw.TrimStart().StartsWith("{")) { throw "$label 根必须是对象，原文件未修改。" }
  try { return ($raw | ConvertFrom-Json) } catch { throw "$label 无法解析，原文件未修改：$($_.Exception.Message)" }
}
function Hash-File($path) {
  # 不用 Get-FileHash：部分机器的 Windows PowerShell 5.1 被裁剪后该命令缺失。
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream)) -replace '-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
  } finally { $stream.Dispose() }
}
function Ensure-Object($obj, $label) { if ($null -eq $obj -or $obj -isnot [pscustomobject]) { throw "$label 必须是对象，原文件未修改。" } }
function Add-Prop($obj, $name, $value) {
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
  else { $p.Value = $value }
}
function Rel-Files {
  $result = @()
  foreach ($dir in @("layouts", "themes", "mods", "pixel-icons")) {
    $base = Join-Path $src $dir
    if (-not (Test-Path -LiteralPath $base -PathType Container)) { throw "安装包缺少 $dir/：$base" }
    foreach ($f in @(Get-ChildItem -LiteralPath $base -Recurse -File)) {
      if ($f.Name -eq "gpui-kit.d.ts" -or $f.Name -eq "jsconfig.json") { continue }
      $rel = $f.FullName.Substring($base.Length).TrimStart('\','/')
      # 清单里的相对路径统一用正斜杠：两个安装器写出的清单才是同一份形状。
      $result += [pscustomobject]@{ Source=$f.FullName; Rel=(("$dir/$rel") -replace '\\', '/') }
    }
  }
  return $result
}
function Preview($items, $label) {
  Write-Host "$label：$($items.Count) 个文件，目标 $Target"
  foreach ($x in $items) { Write-Host "  $label：$x" }
}

$omh = Join-Path $Target ".omh"
$manifestPath = Join-Path $omh "install.json"
$version = ([System.IO.File]::ReadAllText((Join-Path $src "VERSION"))).Trim()
$manifest = if (Test-Path -LiteralPath $manifestPath) { Read-Json $manifestPath "安装清单" } else { [pscustomobject]@{ version=$version; files=[pscustomobject]@{} } }
Ensure-Object $manifest "安装清单"
if ($null -eq $manifest.PSObject.Properties["files"]) { Add-Prop $manifest "files" ([pscustomobject]@{}) }
Ensure-Object $manifest.files "安装清单 files"

if (-not (Test-Path -LiteralPath (Join-Path $Target "settings.json") -PathType Leaf)) { throw "不是 Herdr 配置目录（缺 settings.json）：$Target" }

function Process-Recorded($entries, $isRestore) {
  $todo = @($entries.PSObject.Properties | ForEach-Object { $_.Name })
  if ($DryRun) { Preview $todo "预览"; return }
  $done = 0
  foreach ($prop in $entries.PSObject.Properties) {
    $rel = $prop.Name; $info = $prop.Value; $dst = Join-Path $Target $rel
    $expected = if ($isRestore) { $info.after_sha256 } else { $info.installed_sha256 }
    if (-not (Test-Path -LiteralPath $dst -PathType Leaf) -or ($expected -and (Hash-File $dst) -ne $expected)) { Write-Host "  保留（已修改）：$rel"; continue }
    $prev = $info.previous
    if ($prev.exists) {
      $backupFile = Join-Path (Join-Path (Join-Path $omh "backups") $prev.backup_id) (Join-Path "files" $rel)
      if (-not (Test-Path -LiteralPath $backupFile -PathType Leaf)) { Write-Host "  保留（缺少备份）：$rel"; continue }
      $parent = Split-Path $dst -Parent; if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
      Copy-Item -LiteralPath $backupFile -Destination $dst -Force
    } else { Remove-Item -LiteralPath $dst -Force }
    $done++
  }
  if ($Uninstall) { Remove-Item -LiteralPath $manifestPath -Force }
  Write-Host "完成：处理 $done 个文件，用户改过的文件已保留。"
}

if ($Uninstall -or $Restore) {
  if ($Restore) {
    $backupManifest = Join-Path (Join-Path (Join-Path $omh "backups") $Restore) "manifest.json"
    if (-not (Test-Path -LiteralPath $backupManifest -PathType Leaf)) { throw "找不到备份：$Restore" }
    $bm = Read-Json $backupManifest "备份清单"; Ensure-Object $bm "备份清单"; Ensure-Object $bm.files "备份清单 files"
    Process-Recorded $bm.files $true
  } else { Process-Recorded $manifest.files $false }
  exit 0
}

# 全量预检：源文件、源 JSON、目标 JSON、目标形状均在首次写入前确认。
$sourcePrograms = Read-Json (Join-Path $src "programs.json") "源 programs.json"
Ensure-Object $sourcePrograms "源 programs.json"
Ensure-Object $sourcePrograms.programs "源 programs.json programs"
$progDst = Join-Path $Target "programs.json"
$hadPrograms = Test-Path -LiteralPath $progDst -PathType Leaf
$currentPrograms = if ($hadPrograms) { Read-Json $progDst "目标 programs.json" } else { [pscustomobject]@{ programs=[pscustomobject]@{} } }
Ensure-Object $currentPrograms "目标 programs.json"
if ($null -eq $currentPrograms.PSObject.Properties["programs"]) { Add-Prop $currentPrograms "programs" ([pscustomobject]@{}) }
Ensure-Object $currentPrograms.programs "目标 programs.json programs"
$add = @("omp", "codebuddy") | Where-Object { $null -eq $currentPrograms.programs.PSObject.Properties[$_] }
$files = @(Rel-Files)
if ($add.Count -gt 0) { $files += [pscustomobject]@{ Source=$null; Rel="programs.json" } }
foreach ($f in $files) { if ($f.Source -and -not (Test-Path -LiteralPath $f.Source -PathType Leaf)) { throw "安装包文件不存在：$($f.Source)" } }
if ($DryRun) { Preview (@($files | ForEach-Object { $_.Rel })) "预览"; exit 0 }

$runId = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss-fff")
$backup = Join-Path (Join-Path $omh "backups") $runId; $written = @(); $records = [ordered]@{}
try {
  foreach ($f in $files) {
    $dst = Join-Path $Target $f.Rel
    if ($f.Rel -eq "programs.json" -and $null -eq $f.Source) {
      foreach ($k in $add) { Add-Prop $currentPrograms.programs $k $sourcePrograms.programs.PSObject.Properties[$k].Value }
      $bytes = [System.Text.Encoding]::UTF8.GetBytes(($currentPrograms | ConvertTo-Json -Depth 100) + "`n")
    } elseif ((Test-Path -LiteralPath $dst -PathType Leaf) -and -not $Force) { Write-Host "  跳过：$($f.Rel)"; continue
    } else { $bytes = [System.IO.File]::ReadAllBytes($f.Source) }
    $prev = [ordered]@{ exists=(Test-Path -LiteralPath $dst -PathType Leaf) }
    if ($prev.exists) {
      $prev.sha256 = Hash-File $dst; $prev.backup_id = $runId
      $bp = Join-Path (Join-Path $backup "files") $f.Rel; $bd = Split-Path $bp -Parent
      if (-not (Test-Path $bd)) { New-Item -ItemType Directory -Path $bd -Force | Out-Null }; Copy-Item -LiteralPath $dst -Destination $bp -Force
    }
    $parent = Split-Path $dst -Parent; if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [System.IO.File]::WriteAllBytes($dst, $bytes); $written += $dst
    $records[$f.Rel] = [ordered]@{ installed_sha256=(Hash-File $dst); after_sha256=(Hash-File $dst); previous=$prev; backup_id=$runId }
    Write-Host "  写入：$($f.Rel)"
  }
  if ($records.Count -gt 0) {
    $bm = [ordered]@{ version=$version; files=$records }
    if (-not (Test-Path $backup)) { New-Item -ItemType Directory -Path $backup -Force | Out-Null }
    [System.IO.File]::WriteAllText((Join-Path $backup "manifest.json"), (($bm | ConvertTo-Json -Depth 100) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
    foreach ($key in $records.Keys) { Add-Prop $manifest.files $key ([pscustomobject]$records[$key]) }
    Add-Prop $manifest "version" $version
    if (-not (Test-Path $omh)) { New-Item -ItemType Directory -Path $omh -Force | Out-Null }
    [System.IO.File]::WriteAllText($manifestPath, (($manifest | ConvertTo-Json -Depth 100) + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  }
} catch {
  foreach ($key in $records.Keys) {
    $rel = $key; $dst = Join-Path $Target $rel; $info = $records[$key]; $prev = $info.previous
    if ($prev.exists) {
      $bp = Join-Path (Join-Path $backup "files") $rel
      if (Test-Path -LiteralPath $bp) { Copy-Item -LiteralPath $bp -Destination $dst -Force }
    } elseif (Test-Path -LiteralPath $dst -PathType Leaf) { Remove-Item -LiteralPath $dst -Force }
  }
  if (Test-Path $backup) { Remove-Item $backup -Recurse -Force }
  throw
}
Write-Host "完成：写入 $($records.Count) 个文件，配置目录：$Target"
