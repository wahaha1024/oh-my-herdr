# 把 Oh My Herdr 装进 Herdr 的配置目录：布局 + mods + 主题 + 程序图标。
# 用法：
#   .\install.ps1 -DryRun          # 只看会写什么，不动文件
#   .\install.ps1                  # 不覆盖已有的布局/主题/mod
#   .\install.ps1 -Force           # 覆盖同名文件（自己的改动会丢）
#   .\install.ps1 -Target D:\herdr # 装到别的配置目录
param(
  [string]$Target = (Join-Path $HOME ".config\herdr-app"),
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$Target = [System.IO.Path]::GetFullPath($Target)

if (-not (Test-Path (Join-Path $Target "settings.json"))) {
  throw "不像 Herdr 的配置目录（缺 settings.json）：$Target`n先用 Herdr 打开一次，它会把这里建好。"
}
foreach ($dir in 'layouts', 'mods', 'themes') {
  if (-not (Test-Path -LiteralPath (Join-Path $src $dir) -PathType Container)) {
    throw "安装包缺少 $dir/：$src`n请下载完整的 Oh My Herdr 安装包，不要只下载 install.ps1。"
  }
}

$copied = 0
$skipped = 0

function Copy-Tree($from, $to) {
  if (-not (Test-Path $from)) { return }
  Get-ChildItem $from -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($from.Length).TrimStart('\', '/')
    $dst = Join-Path $to $rel
    if ((Test-Path $dst) -and -not $Force) {
      Write-Host ("  跳过  " + $rel)
      $script:skipped++
      return
    }
    Write-Host ("  写入  " + $rel)
    $script:copied++
    if ($DryRun) { return }
    $dir = Split-Path $dst -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item $_.FullName $dst -Force
  }
}

Write-Host "目标：$Target"
if ($DryRun) { Write-Host "（DryRun：不会改动任何文件）" }
Write-Host ""

Write-Host "布局 layouts/"
Copy-Tree (Join-Path $src "layouts") (Join-Path $Target "layouts")

Write-Host "mods/"
foreach ($m in Get-ChildItem (Join-Path $src "mods") -Directory) {
  Write-Host (" " + $m.Name)
  Copy-Tree $m.FullName (Join-Path $Target "mods\$($m.Name)")
}

Write-Host "主题 themes/"
Copy-Tree (Join-Path $src "themes") (Join-Path $Target "themes")

Write-Host "像素图标 pixel-icons/"
Copy-Tree (Join-Path $src "pixel-icons") (Join-Path $Target "pixel-icons")

# 只补 programs.omp 和 programs.codebuddy 两条；已有条目一律保留，-Force 也不覆盖。
# 程序表是用户自己的配置，覆盖它会丢掉别人加的图标和启动参数。
$progSrc = Join-Path $src "programs.json"
$progDst = Join-Path $Target "programs.json"
$progKeys = @('omp', 'codebuddy')
Write-Host ""
Write-Host "程序图标 programs.json"
$pw = Get-Content -LiteralPath $progSrc -Raw -Encoding UTF8 | ConvertFrom-Json
$hadProgramsFile = Test-Path -LiteralPath $progDst
$ph = [pscustomobject]@{}
if ($hadProgramsFile) {
  $raw = Get-Content -LiteralPath $progDst -Raw -Encoding UTF8
  if (-not $raw.TrimStart().StartsWith('{')) {
    throw "programs.json 的根必须是对象，原文件未修改。"
  }
  try { $ph = $raw | ConvertFrom-Json } catch {
    throw "programs.json 无法解析，原文件未修改：$($_.Exception.Message)"
  }
  if ($ph -isnot [pscustomobject]) {
    throw "programs.json 的根必须是对象，原文件未修改。"
  }
}
if ($null -eq $ph.PSObject.Properties['programs']) {
  $ph | Add-Member -NotePropertyName programs -NotePropertyValue ([pscustomobject]@{})
} elseif ($ph.programs -isnot [pscustomobject]) {
  throw "programs.json 的 programs 必须是对象，原文件未修改。"
}
$add = @()
foreach ($k in $progKeys) {
  if ($null -ne $ph.programs.PSObject.Properties[$k]) {
    Write-Host "  跳过  programs.$k 已存在"
    $script:skipped++
  } else {
    Write-Host "  加上  programs.$k"
    $add += $k
    $script:copied++
  }
}
if ($add.Count -gt 0 -and -not $DryRun) {
  if ($hadProgramsFile) {
    Copy-Item -LiteralPath $progDst -Destination "$progDst.bak" -Force
    Write-Host '  原文件备份在 programs.json.bak'
  }
  foreach ($k in $add) {
    $ph.programs | Add-Member -NotePropertyName $k -NotePropertyValue $pw.programs.PSObject.Properties[$k].Value
  }
  $json = $ph | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($progDst, $json, (New-Object System.Text.UTF8Encoding($false)))
}

Write-Host ""
if ($DryRun) {
  Write-Host "预览：计划写入 $copied 个文件，跳过 $skipped 个。"
} else {
  Write-Host "完成：写入 $copied 个文件，跳过 $skipped 个。"
  if ($copied -eq 0) { Write-Warning '没有写入任何文件。' }
}
if ($skipped -gt 0 -and -not $Force -and -not $DryRun) {
  Write-Host ""
  Write-Host "注意：跳过的文件还是旧版本。" -ForegroundColor Yellow
  Write-Host "  之前装过的话，再跑一次并加 -Force，否则布局 / mod / 主题不会更新：" -ForegroundColor Yellow
  Write-Host "    .\install.ps1 -Force" -ForegroundColor Yellow
}
if ($DryRun) {
  Write-Host "DryRun 结束，什么都没改。去掉 -DryRun 再跑一次。"
  return
}

Write-Host ""
Write-Host "接下来可以：" -ForegroundColor Green
Write-Host "  herdr-app check mods/inkstone-workbench   # 每个 mod 都可以 check 一遍"
Write-Host "  herdr-app do layout.switch '{""name"":""oh-my-herdr""}'"
