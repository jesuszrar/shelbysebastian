# FTP Upload Script for Windows PowerShell
param(
    [string]$FTPHost = '149.62.37.234',
    [int]$FTPPort = 65002,
    [string]$FTPUser = 'u970251027',
    [string]$FTPPass = '3016030030Zr@',
    [string]$SourceDir = './dist',
    [string]$RemoteDir = 'public_html'
)

# Create FTP connection
$FTPWebRequest = [System.Net.FtpWebRequest]::Create("ftp://${FTPHost}:${FTPPort}/${RemoteDir}/")
$FTPWebRequest.Credentials = New-Object System.Net.NetworkCredential($FTPUser, $FTPPass)
$FTPWebRequest.Method = [System.Net.WebRequestMethods+Ftp]::ListDirectory
$FTPWebRequest.UseBinary = $true
$FTPWebRequest.UsePassive = $true
$FTPWebRequest.KeepAlive = $true
$FTPWebRequest.EnableSsl = $false

Write-Host "Testing FTP connection..."
try {
    $Response = $FTPWebRequest.GetResponse()
    Write-Host "✓ FTP connection successful"
    $Response.Close()
} catch {
    Write-Host "✗ FTP connection failed: $_"
    exit 1
}

# Get files to upload
$FilesToUpload = Get-ChildItem -Path $SourceDir -Recurse -File

Write-Host "Found $($FilesToUpload.Count) files to upload"

# Upload each file
$uploaded = 0
foreach ($file in $FilesToUpload) {
    $relPath = $file.FullName.Replace($SourceDir, '').Replace('\', '/').TrimStart('/')
    $RemotePath = "${RemoteDir}/${relPath}"
    
    $UploadRequest = [System.Net.FtpWebRequest]::Create("ftp://${FTPHost}:${FTPPort}/${RemotePath}")
    $UploadRequest.Credentials = New-Object System.Net.NetworkCredential($FTPUser, $FTPPass)
    $UploadRequest.Method = [System.Net.WebRequestMethods+Ftp]::UploadFile
    $UploadRequest.UseBinary = $true
    $UploadRequest.UsePassive = $true
    $UploadRequest.KeepAlive = $true
    $UploadRequest.EnableSsl = $false
    
    try {
        $fileStream = [System.IO.File]::OpenRead($file.FullName)
        $RequestStream = $UploadRequest.GetRequestStream()
        $fileStream.CopyTo($RequestStream)
        $RequestStream.Close()
        $fileStream.Close()
        
        $response = $UploadRequest.GetResponse()
        $response.Close()
        
        Write-Host "✓ Uploaded: $relPath"
        $uploaded++
    } catch {
        Write-Host "✗ Failed to upload $relPath : $_"
    }
}

Write-Host "`n=== FTP Upload Complete ==="
Write-Host "Uploaded $uploaded/$($FilesToUpload.Count) files" | Out-String
