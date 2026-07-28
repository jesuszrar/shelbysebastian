$FTPHost = '149.62.37.234'
$FTPPort = 65002
$FTPUser = 'u970251027'
$FTPPass = '3016030030Zr@'
$SourceDir = './dist'
$RemoteDir = 'public_html'

Write-Host "FTP Upload starting..."
Write-Host "Host: $FTPHost Port: $FTPPort"

$FTPWebRequest = [System.Net.FtpWebRequest]::Create("ftp://${FTPHost}:${FTPPort}/")
$FTPWebRequest.Credentials = New-Object System.Net.NetworkCredential($FTPUser, $FTPPass)
$FTPWebRequest.Method = [System.Net.WebRequestMethods+Ftp]::PrintWorkingDirectory
$FTPWebRequest.UseBinary = $true
$FTPWebRequest.UsePassive = $true
$FTPWebRequest.EnableSsl = $false

Write-Host "Testing connection..."
try {
    $Response = $FTPWebRequest.GetResponse()
    Write-Host "Connection successful!"
    $Response.Close()
} catch {
    Write-Host "Connection failed: $_"
    exit 1
}
