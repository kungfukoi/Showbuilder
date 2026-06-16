$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LauncherPath = Join-Path $Root "Start-NewtBuilder.ps1"
$IconPath = Join-Path $Root "public\newtbuilder.ico"
$ShortcutName = "NewtBuilder.lnk"

function Write-UInt16 {
  param(
    [System.IO.BinaryWriter]$Writer,
    [int]$Value
  )
  $Writer.Write([UInt16]$Value)
}

function Write-UInt32 {
  param(
    [System.IO.BinaryWriter]$Writer,
    [long]$Value
  )
  $Writer.Write([UInt32]$Value)
}

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )

  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function New-NewtBuilderIcon {
  param([string]$Path)

  Add-Type -AssemblyName System.Drawing

  $bitmap = New-Object System.Drawing.Bitmap 256, 256, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $background = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.ColorTranslator]::FromHtml("#20382c"))
  $bodyBrush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.ColorTranslator]::FromHtml("#6dd0a5"))
  $eyeBrush = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.ColorTranslator]::FromHtml("#161613"))
  $linePen = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.ColorTranslator]::FromHtml("#f3f0e8")), 12
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $backgroundPath = New-RoundedRectanglePath -X 0 -Y 0 -Width 256 -Height 256 -Radius 48
  $graphics.FillPath($background, $backgroundPath)

  $bodyPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $bodyPath.StartFigure()
  $bodyPath.AddBezier(60, 156, 88, 76, 160, 62, 200, 91)
  $bodyPath.AddBezier(200, 91, 188, 104, 181, 120, 181, 140)
  $bodyPath.AddBezier(181, 140, 181, 186, 145, 214, 103, 207)
  $bodyPath.AddBezier(103, 207, 78, 203, 63, 184, 60, 156)
  $bodyPath.CloseFigure()
  $graphics.FillPath($bodyBrush, $bodyPath)

  $graphics.FillEllipse($eyeBrush, 152, 91, 32, 32)
  $graphics.DrawBezier($linePen, 72, 164, 103, 174, 134, 158, 164, 132)

  $memory = New-Object System.IO.MemoryStream
  $bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $memory.ToArray()
  $memory.Dispose()

  $iconStream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter $iconStream
  Write-UInt16 -Writer $writer -Value 0
  Write-UInt16 -Writer $writer -Value 1
  Write-UInt16 -Writer $writer -Value 1
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  Write-UInt16 -Writer $writer -Value 1
  Write-UInt16 -Writer $writer -Value 32
  Write-UInt32 -Writer $writer -Value $pngBytes.Length
  Write-UInt32 -Writer $writer -Value 22
  $writer.Write($pngBytes)
  $writer.Flush()

  [System.IO.File]::WriteAllBytes($Path, $iconStream.ToArray())

  $writer.Dispose()
  $iconStream.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()
  $background.Dispose()
  $bodyBrush.Dispose()
  $eyeBrush.Dispose()
  $linePen.Dispose()
  $backgroundPath.Dispose()
  $bodyPath.Dispose()
}

if (-not (Test-Path $LauncherPath)) {
  throw "Launcher not found: $LauncherPath"
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $IconPath) | Out-Null
New-NewtBuilderIcon -Path $IconPath

$desktop = [Environment]::GetFolderPath("Desktop")
if (-not $desktop) {
  throw "Could not find the current user's Desktop folder."
}

$shortcutPath = Join-Path $desktop $ShortcutName
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$LauncherPath`""
$shortcut.WorkingDirectory = $Root
$shortcut.IconLocation = "$IconPath,0"
$shortcut.Description = "Launch NewtBuilder"
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "Created Desktop shortcut: $shortcutPath"
Write-Host "Shortcut icon: $IconPath"
