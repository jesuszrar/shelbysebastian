param(
    [string]$DistFolder = "dist",
    [string]$OutZip = "dist.zip"
)

if (-not (Test-Path -Path $DistFolder)) {
    Write-Error "Carpeta '$DistFolder' no encontrada. Ejecuta `npm run build` en el proyecto antes.";
    exit 1
}

$outPath = Join-Path -Path (Get-Location) -ChildPath $OutZip
if (Test-Path $outPath) { Remove-Item $outPath -Force }

Compress-Archive -Path (Join-Path $DistFolder "*") -DestinationPath $outPath -Force
Write-Output "Archivo creado: $outPath"
