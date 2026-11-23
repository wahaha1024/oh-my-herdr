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
Sync-Tree (Join-Path $From "themes") (Join-Path $dst "themes") { param($f) $f.Name -in @("qingci.json", "xuanmo.json", "zhi.json") }

# 像素图标与程序表；不把实机的个人程序或顶层配置带入发行包。
Sync-Tree (Join-Path $From "pixel-icons") (Join-Path $dst "pixel-icons")
function Read-ProgramConfig($path) {
  $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  $doc = $raw | ConvertFrom-Json
  if (-not $raw.TrimStart().StartsWith('{') -or $doc -isnot [pscustomobject]) {
    throw "programs.json 的根必须是对象：$path"
  }
  if ($null -ne $doc.PSObject.Properties['programs'] -and $doc.programs -isnot [pscustomobject]) {
    throw "programs.json 的 programs 必须是对象：$path"
  }
  $doc
}

$progSrc = Join-Path $From 'programs.json'
$progDst = Join-Path $dst 'programs.json'
if (Test-Path -LiteralPath $progSrc) {
  $live = Read-ProgramConfig $progSrc
  $entries = foreach ($key in 'omp', 'codebuddy') {
    if ($null -ne $live.programs) {
      $entry = $live.programs.PSObject.Properties[$key]
      if ($null -ne $entry -and $entry.Name -ceq $key) { $entry }
    }
  }
  if ($entries) {
    $package = if (Test-Path -LiteralPath $progDst) { Read-ProgramConfig $progDst } else { [pscustomobject]@{} }
    if ($null -eq $package.PSObject.Properties['programs']) {
      $package | Add-Member -NotePropertyName programs -NotePropertyValue ([pscustomobject]@{})
    }
    $changed = $false
    foreach ($entry in $entries) {
      $key = $entry.Name
      $old = $package.programs.PSObject.Properties[$key]
      if ($null -eq $old) {
        $package.programs | Add-Member -NotePropertyName $key -NotePropertyValue $entry.Value
        $changed = $true
      } elseif ($old.Name -ceq $key -and (ConvertTo-Json -InputObject $old.Value -Depth 100 -Compress) -cne (ConvertTo-Json -InputObject $entry.Value -Depth 100 -Compress)) {
        $old.Value = $entry.Value
        $changed = $true
      }
    }
    if ($changed) {
      $json = $package | ConvertTo-Json -Depth 100
      [System.IO.File]::WriteAllText($progDst, $json, (New-Object System.Text.UTF8Encoding($false)))
      $n++
    }
  }
}

# mods：所有 inkstone-* 加上 cockpit
$dirs = Get-ChildItem (Join-Path $From "mods") -Directory | Where-Object { $_.Name -like "inkstone-*" -or $_.Name -eq "cockpit" }
foreach ($d in $dirs) {
  Sync-Tree $d.FullName (Join-Path $dst "mods\$($d.Name)")
}

Write-Host ("同步完成：{0} 个文件 ← {1}" -f $n, $From)
