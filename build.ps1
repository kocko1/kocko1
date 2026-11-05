$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path -LiteralPath $compiler)) { throw 'The Windows .NET Framework C# compiler is required.' }
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$PSScriptRoot\Simple Notepad.exe" "$PSScriptRoot\Notepad.cs"
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
Write-Output "Built: $PSScriptRoot\Simple Notepad.exe"
