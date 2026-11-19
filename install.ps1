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

# programs.json：只加「OMP 用像素 Codex 图标」这一条，别人的程序表不动。
$progSrc = Join-Path $src "programs.json"
$progDst = Join-Path $Target "programs.json"
Write-Host ""
Write-Host "程序图标 programs.json"
if (-not (Test-Path $progDst)) {
  Write-Host "  写入  programs.json（OMP 显示像素 Codex 图标）"
  $script:copied++
  if (-not $DryRun) { Copy-Item $progSrc $progDst -Force }
} else {
  $pw = Get-Content $progSrc -Raw | ConvertFrom-Json
  $ph = Get-Content $progDst -Raw | ConvertFrom-Json
  if (-not $ph.programs) {
    $ph | Add-Member -NotePropertyName programs -NotePropertyValue ([pscustomobject]@{})
  }
  $old = $ph.programs.PSObject.Properties["omp"]
  if ($null -eq $old) {
    Write-Host "  加上  programs.omp"
    if (-not $DryRun) {
      Copy-Item $progDst "$progDst.bak" -Force
      $ph.programs | Add-Member -NotePropertyName omp -NotePropertyValue $pw.programs.omp
      $json = $ph | ConvertTo-Json -Depth 20
      [System.IO.File]::WriteAllText($progDst, $json, (New-Object System.Text.UTF8Encoding($false)))
      Write-Host "  原文件备份在 programs.json.bak"
    }
  } else {
    Write-Host ("  跳过  programs.omp 已存在（现在是 " + ($old.Value | ConvertTo-Json -Compress -Depth 5) + "）")
    $script:skipped++
  }
}

Write-Host ""
Write-Host ("完成：写入 $copied 个文件，跳过 $skipped 个。")
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
