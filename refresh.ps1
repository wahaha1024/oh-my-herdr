# 反向同步：把 Herdr 配置目录里当前的布局、mods、主题抓回这个包。
# 改完 mod 之后跑一次，包里就是最新的一版。
# 用法： .\refresh.ps1            （默认从 ~/.config/herdr-app 抓）
#        .\refresh.ps1 -From D:\herdr
param(
  [string]$From = (Join-Path $HOME ".config\herdr-app")
)

$ErrorActionPreference = "Stop"
$dst = $PSScriptRoot
$From = [System.IO.Path]::GetFullPath($From)

if (-not (Test-Path (Join-Path $From "layouts\oh-my-herdr.json"))) {
  throw "这里没有 oh-my-herdr 布局：$From"
}

# mod 目录里不带这些：类型提示文件，每个 mod 一份几百 KB，装的时候不需要。
$skip = @("gpui-kit.d.ts", "jsconfig.json")

$n = 0
function Sync-Tree($from, $to, $filter) {
  Get-ChildItem $from -Recurse -File | ForEach-Object {
    if ($skip -contains $_.Name) { return }
    if ($filter -and -not (& $filter $_)) { return }
    $rel = $_.FullName.Substring($from.Length).TrimStart('\', '/')
    $target = Join-Path $to $rel
    $dir = Split-Path $target -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item $_.FullName $target -Force
    $script:n++
  }
}

# 布局 + 预览
Copy-Item (Join-Path $From "layouts\oh-my-herdr.json") (Join-Path $dst "layouts\oh-my-herdr.json") -Force
Copy-Item (Join-Path $From "layouts\oh-my-herdr.png") (Join-Path $dst "layouts\oh-my-herdr.png") -Force
Copy-Item (Join-Path $From "layouts\oh-my-herdr.png") (Join-Path $dst "preview.png") -Force

# 主题
Sync-Tree (Join-Path $From "themes") (Join-Path $dst "themes") { param($f) $f.Name -in @("qingci.json", "xuanmo.json") }

# mods：所有 inkstone-* 加上 cockpit
$dirs = Get-ChildItem (Join-Path $From "mods") -Directory | Where-Object { $_.Name -like "inkstone-*" -or $_.Name -eq "cockpit" }
foreach ($d in $dirs) {
  Sync-Tree $d.FullName (Join-Path $dst "mods\$($d.Name)")
}

Write-Host ("同步完成：{0} 个文件 ← {1}" -f $n, $From)
