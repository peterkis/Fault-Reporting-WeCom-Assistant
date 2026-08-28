[CmdletBinding()]
param(
    [ValidatePattern('^wss://')]
    [string]$Uri = 'wss://openws.work.weixin.qq.com',

    [ValidateRange(3, 60)]
    [int]$TimeoutSeconds = 15,

    [switch]$SkipPublicEgress
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-SafeErrorMessage {
    param([System.Exception]$Exception)

    # 仅输出诊断信息；若异常中意外包含 URI 用户信息，先脱敏。
    return (($Exception.Message -replace '://[^/@\s]+@', '://[redacted]@') -replace '(?i)(token|secret|key)=([^&\s]+)', '$1=[redacted]')
}

function New-FailureResult {
    param([System.Exception]$Exception)

    return [ordered]@{
        ok = $false
        error_type = $Exception.GetType().FullName
        error_message = Get-SafeErrorMessage -Exception $Exception
    }
}

function Connect-Tcp {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$Timeout
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        $connectTask = $client.ConnectAsync($HostName, $Port)
        if (-not $connectTask.Wait([TimeSpan]::FromSeconds($Timeout))) {
            throw [TimeoutException]::new("TCP connect timed out after $Timeout seconds.")
        }
        $watch.Stop()
        return [ordered]@{
            ok = $true
            remote_endpoint = $client.Client.RemoteEndPoint.ToString()
            elapsed_ms = [Math]::Round($watch.Elapsed.TotalMilliseconds, 0)
        }
    }
    finally {
        $client.Dispose()
    }
}

function Test-TlsSni {
    param(
        [string]$HostName,
        [int]$Port,
        [int]$Timeout
    )

    $client = [System.Net.Sockets.TcpClient]::new()
    $stream = $null
    $ssl = $null
    try {
        $connectTask = $client.ConnectAsync($HostName, $Port)
        if (-not $connectTask.Wait([TimeSpan]::FromSeconds($Timeout))) {
            throw [TimeoutException]::new("TCP connect timed out after $Timeout seconds.")
        }

        $stream = $client.GetStream()
        # 使用系统证书验证：若存在 TLS 拦截或证书链/主机名错误，握手会失败并被记录。
        $ssl = [System.Net.Security.SslStream]::new($stream, $false)
        $authenticateTask = $ssl.AuthenticateAsClientAsync($HostName)
        if (-not $authenticateTask.Wait([TimeSpan]::FromSeconds($Timeout))) {
            throw [TimeoutException]::new("TLS handshake timed out after $Timeout seconds.")
        }

        $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($ssl.RemoteCertificate)
        return [ordered]@{
            ok = $true
            protocol = $ssl.SslProtocol.ToString()
            certificate_subject = $certificate.Subject
            certificate_issuer = $certificate.Issuer
            certificate_thumbprint_sha1 = $certificate.Thumbprint
            certificate_not_after_utc = $certificate.NotAfter.ToUniversalTime().ToString('o')
            certificate_validation = 'System default validation passed'
        }
    }
    finally {
        if ($null -ne $ssl) { $ssl.Dispose() }
        elseif ($null -ne $stream) { $stream.Dispose() }
        $client.Dispose()
    }
}

function Test-WebSocketUpgrade {
    param(
        [uri]$TargetUri,
        [int]$Timeout
    )

    $socket = [System.Net.WebSockets.ClientWebSocket]::new()
    $cancellation = [System.Threading.CancellationTokenSource]::new()
    try {
        $cancellation.CancelAfter([TimeSpan]::FromSeconds($Timeout))
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        [void]$socket.ConnectAsync($TargetUri, $cancellation.Token).GetAwaiter().GetResult()
        $watch.Stop()
        return [ordered]@{
            ok = ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open)
            state = $socket.State.ToString()
            elapsed_ms = [Math]::Round($watch.Elapsed.TotalMilliseconds, 0)
        }
    }
    catch {
        return New-FailureResult -Exception $_.Exception
    }
    finally {
        $cancellation.Dispose()
        $socket.Dispose()
    }
}

try {
    $targetUri = [uri]$Uri
    if ($targetUri.Port -notin 443, -1) {
        throw 'G0-001 only permits WSS over TCP 443.'
    }

    $port = if ($targetUri.IsDefaultPort) { 443 } else { $targetUri.Port }
    $environmentProxyVariables = @(
        'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
        'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }

    $proxy = [System.Net.WebRequest]::GetSystemWebProxy()
    $proxyConfiguredForTarget = -not $proxy.IsBypassed($targetUri)

    $result = [ordered]@{
        test_id = 'G0-001'
        started_at_utc = [DateTime]::UtcNow.ToString('o')
        server = [Environment]::MachineName
        target = [ordered]@{
            uri = $targetUri.GetLeftPart([System.UriPartial]::Authority)
            host = $targetUri.Host
            port = $port
        }
        secret_handling = 'No local configuration or credential is read; proxy values are not emitted.'
        proxy = [ordered]@{
            system_proxy_configured_for_target = $proxyConfiguredForTarget
            environment_proxy_variable_names = @($environmentProxyVariables)
        }
        public_egress = $null
        dns = $null
        tcp_443 = $null
        tls_sni = $null
        websocket_upgrade = $null
    }

    if (-not $SkipPublicEgress) {
        try {
            $http = [System.Net.Http.HttpClient]::new()
            $http.Timeout = [TimeSpan]::FromSeconds([Math]::Min($TimeoutSeconds, 10))
            try {
                $egressIp = $http.GetStringAsync('https://api.ipify.org').GetAwaiter().GetResult().Trim()
                $result.public_egress = [ordered]@{ ok = $true; ip = $egressIp }
            }
            finally {
                $http.Dispose()
            }
        }
        catch {
            $result.public_egress = New-FailureResult -Exception $_.Exception
        }
    }

    try {
        $addresses = @([System.Net.Dns]::GetHostAddresses($targetUri.Host) |
            ForEach-Object { $_.IPAddressToString } |
            Sort-Object -Unique)
        $result.dns = [ordered]@{ ok = ($addresses.Count -gt 0); addresses = @($addresses) }
    }
    catch {
        $result.dns = New-FailureResult -Exception $_.Exception
    }

    try { $result.tcp_443 = Connect-Tcp -HostName $targetUri.Host -Port $port -Timeout $TimeoutSeconds }
    catch { $result.tcp_443 = New-FailureResult -Exception $_.Exception }

    try { $result.tls_sni = Test-TlsSni -HostName $targetUri.Host -Port $port -Timeout $TimeoutSeconds }
    catch { $result.tls_sni = New-FailureResult -Exception $_.Exception }

    $result.websocket_upgrade = Test-WebSocketUpgrade -TargetUri $targetUri -Timeout $TimeoutSeconds
    $result | ConvertTo-Json -Depth 8
}
catch {
    [ordered]@{
        test_id = 'G0-001'
        started_at_utc = [DateTime]::UtcNow.ToString('o')
        fatal_error = New-FailureResult -Exception $_.Exception
    } | ConvertTo-Json -Depth 8
    exit 1
}
