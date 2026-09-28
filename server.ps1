param(
    [int]$Port = 8788
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PublicDir = Join-Path $Root "public"
$VehiclesPath = Join-Path $Root "vehicles.json"
$Prefix = "http://127.0.0.1:$Port/"

function Read-Vehicles {
    if (-not (Test-Path $VehiclesPath)) {
        return [ordered]@{}
    }
    $raw = Get-Content -Raw -Encoding UTF8 $VehiclesPath
    if ([string]::IsNullOrWhiteSpace($raw)) { return [ordered]@{} }
    return $raw | ConvertFrom-Json
}

function Save-Vehicles($obj) {
    $obj | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $VehiclesPath
}

function Normalize-Plaka([string]$plaka) {
    if (-not $plaka) { return "" }
    return ($plaka.ToUpperInvariant() -replace "[\s\-]", "")
}

function Convert-ClockToSeconds([string]$clock) {
    if ($clock -notmatch "^(\d{1,2}):(\d{2})(?::(\d{2}))?$") { return $null }
    $h = [int]$Matches[1]
    $m = [int]$Matches[2]
    $s = if ($Matches[3]) { [int]$Matches[3] } else { 0 }
    return ($h * 3600) + ($m * 60) + $s
}

function Convert-SecondsToClock($seconds) {
    if ($null -eq $seconds) { return $null }
    $day = [int][Math]::Floor($seconds / 86400)
    $rem = [int]($seconds % 86400)
    if ($rem -lt 0) { $rem += 86400 }
    $h = [int][Math]::Floor($rem / 3600)
    $m = [int][Math]::Floor(($rem % 3600) / 60)
    $s = [int]($rem % 60)
    $clock = "{0:d2}:{1:d2}:{2:d2}" -f $h, $m, $s
    if ($day -gt 0) { return "$clock+$day" }
    return $clock
}

function Get-Median($values) {
    $arr = @($values | Where-Object { $_ -ne $null })
    if ($arr.Count -eq 0) { return $null }
    $sorted = $arr | Sort-Object
    $n = @($sorted).Count
    if ($n -eq 1) { return [double]$sorted[0] }
    $mid = [Math]::Floor(($n - 1) / 2)
    if ($n % 2 -eq 1) { return [double]$sorted[$mid] }
    return ([double]$sorted[$mid] + [double]$sorted[$mid + 1]) / 2.0
}

function Decode-Html([string]$text) {
    if (-not $text) { return "" }
    return [System.Net.WebUtility]::HtmlDecode($text)
}

function Clean-StopName([string]$name) {
    $name = Decode-Html $name
    $name = $name -replace "(?s)<br\s*/?>", " "
    $name = $name -replace "(?s)<[^>]+>", " "
    $name = ($name -replace "\s+", " ").Trim()
    return $name
}

function Parse-Cell([string]$inner) {
    $times = [regex]::Matches($inner, ">(\d{2}:\d{2}:\d{2})<") | ForEach-Object { $_.Groups[1].Value }
    $site = $null
    $siteMatch = [regex]::Match($inner, "<span[^>]*>\s*([+\-]?\d+)\s*</span>")
    if ($siteMatch.Success) {
        $site = [int]$siteMatch.Groups[1].Value
    }
    $giris = $null
    $cikis = $null
    if (@($times).Count -ge 1) { $giris = $times[0] }
    if (@($times).Count -ge 2) { $cikis = $times[1] }
    return @{
        giris     = $giris
        cikis     = $cikis
        siteRotar = $site
        ham       = $false
    }
}

function Parse-ReportHtml([string]$html) {
    $hatAdi = $null
    $hatMatch = [regex]::Match($html, ">([^<]*GRUP[^<]*)<")
    if ($hatMatch.Success) { $hatAdi = (Decode-Html $hatMatch.Groups[1].Value).Trim() }

    $kod = $null
    $kodMatch = [regex]::Match($html, "<td[^>]*>\s*([A-Z]{1,4}\d{1,4})\s*</td>\s*<td[^>]*>\s*[0-9A-Z]+")
    if ($kodMatch.Success) { $kod = $kodMatch.Groups[1].Value }

    $tableMatches = [regex]::Matches($html, "(?is)<table[^>]*>\s*<thead[^>]*>.*?</table>")
    $directions = @()
    $dirIndex = 0

    foreach ($tm in $tableMatches) {
        $table = $tm.Value
        if ($table -notmatch "Sefer") { continue }

        $ths = [regex]::Matches($table, "(?is)<th[^>]*>(.*?)</th>") | ForEach-Object { Clean-StopName $_.Groups[1].Value }
        if (@($ths).Count -lt 4) { continue }

        $stopNames = @()
        for ($i = 2; $i -lt $ths.Count; $i++) {
            $stopNames += $ths[$i]
        }

        $trs = [regex]::Matches($table, "(?is)<tr>(.*?)</tr>")
        $trips = @()
        foreach ($tr in $trs) {
            $row = $tr.Groups[1].Value
            if ($row -match "<th") { continue }
            $tds = [regex]::Matches($row, "(?is)<td[^>]*>(.*?)</td>") | ForEach-Object { $_.Groups[1].Value }
            if (@($tds).Count -lt 3) { continue }

            $seferRaw = Clean-StopName $tds[0]
            $sefer = 0
            [void][int]::TryParse($seferRaw, [ref]$sefer)
            $orer = $null
            $orerMatch = [regex]::Match($tds[1], "(\d{2}:\d{2}:\d{2})")
            if ($orerMatch.Success) { $orer = $orerMatch.Groups[1].Value }

            $stops = @()
            for ($i = 2; $i -lt $tds.Count; $i++) {
                $parsed = Parse-Cell $tds[$i]
                $name = if (($i - 2) -lt $stopNames.Count) { $stopNames[$i - 2] } else { "Durak $($i - 1)" }
                $stops += [ordered]@{
                    ad        = $name
                    giris     = $parsed.giris
                    cikis     = $parsed.cikis
                    siteRotar = $parsed.siteRotar
                }
            }

            $trips += [ordered]@{
                sefer = $sefer
                orer  = $orer
                stops = $stops
            }
        }

        $dirIndex++
        $dirName = if ($dirIndex -eq 1) { "Gidis" } elseif ($dirIndex -eq 2) { "Donus" } else { "Yon $dirIndex" }
        $directions += [ordered]@{
            ad        = $dirName
            duraklar  = $stopNames
            seferler  = $trips
        }
    }

    return [ordered]@{
        hatAdi     = $hatAdi
        kod        = $kod
        yonler     = $directions
    }
}

function Add-DelayCalculations($parsed) {
    foreach ($yon in $parsed.yonler) {
        $stopCount = @($yon.duraklar).Count
        $offsetLists = @{}
        for ($s = 0; $s -lt $stopCount; $s++) { $offsetLists[$s] = New-Object System.Collections.Generic.List[double] }

        foreach ($sefer in $yon.seferler) {
            $startSec = $null
            foreach ($st in $sefer.stops) {
                $sec = Convert-ClockToSeconds $st.giris
                if ($null -ne $sec) { $startSec = $sec; break }
            }
            if ($null -eq $startSec) { continue }

            $prev = $startSec
            for ($s = 0; $s -lt $stopCount -and $s -lt @($sefer.stops).Count; $s++) {
                $sec = Convert-ClockToSeconds $sefer.stops[$s].giris
                if ($null -eq $sec) { continue }
                if ($sec + 6 * 3600 -lt $prev) { $sec += 86400 }
                $offsetLists[$s].Add([double]($sec - $startSec))
                $prev = $sec
            }
        }

        $medianOffsets = @()
        for ($s = 0; $s -lt $stopCount; $s++) {
            $medianOffsets += (Get-Median @($offsetLists[$s]))
        }

        $refOffsets = @()
        $refTrip = $null
        foreach ($sefer in $yon.seferler) {
            $has = $false
            foreach ($st in $sefer.stops) { if ($st.giris) { $has = $true; break } }
            if ($has) { $refTrip = $sefer; break }
        }
        if ($refTrip) {
            $refStart = $null
            foreach ($st in $refTrip.stops) {
                $sec = Convert-ClockToSeconds $st.giris
                if ($null -ne $sec) { $refStart = $sec; break }
            }
            $prev = $refStart
            for ($s = 0; $s -lt $stopCount; $s++) {
                $sec = $null
                if ($s -lt @($refTrip.stops).Count) {
                    $sec = Convert-ClockToSeconds $refTrip.stops[$s].giris
                }
                if ($null -eq $sec -or $null -eq $refStart) {
                    $refOffsets += $null
                    continue
                }
                if ($sec + 6 * 3600 -lt $prev) { $sec += 86400 }
                $refOffsets += ($sec - $refStart)
                $prev = $sec
            }
        }

        $yon.medyanOffsetSn = $medianOffsets
        $yon.referansOffsetSn = $refOffsets

        foreach ($sefer in $yon.seferler) {
            $startSec = $null
            foreach ($st in $sefer.stops) {
                $sec = Convert-ClockToSeconds $st.giris
                if ($null -ne $sec) { $startSec = $sec; break }
            }

            $prev = $startSec
            for ($s = 0; $s -lt @($sefer.stops).Count; $s++) {
                $st = $sefer.stops[$s]
                $actual = Convert-ClockToSeconds $st.giris
                if ($null -ne $actual -and $null -ne $prev -and ($actual + 6 * 3600 -lt $prev)) {
                    $actual += 86400
                }
                if ($null -ne $actual) { $prev = $actual }

                $planMedyan = $null
                $planRef = $null
                if ($null -ne $startSec -and $s -lt $medianOffsets.Count -and $null -ne $medianOffsets[$s]) {
                    $planMedyan = [int][Math]::Round($startSec + $medianOffsets[$s])
                }
                if ($null -ne $startSec -and $s -lt $refOffsets.Count -and $null -ne $refOffsets[$s]) {
                    $planRef = [int][Math]::Round($startSec + $refOffsets[$s])
                }

                $rotarMedyan = $null
                $rotarRef = $null
                if ($null -ne $actual -and $null -ne $planMedyan) {
                    $rotarMedyan = [int][Math]::Round(($actual - $planMedyan) / 60.0)
                }
                if ($null -ne $actual -and $null -ne $planRef) {
                    $rotarRef = [int][Math]::Round(($actual - $planRef) / 60.0)
                }

                $st.planlananMedyan = Convert-SecondsToClock $planMedyan
                $st.planlananReferans = Convert-SecondsToClock $planRef
                $st.rotarMedyanDk = $rotarMedyan
                $st.rotarReferansDk = $rotarRef
                $st.rotarSiteDk = $st.siteRotar
            }
        }
    }
    return $parsed
}

function Get-Report([string]$plaka, [string]$date, [string]$vehicleId, [string]$hatId) {
    $plaka = Normalize-Plaka $plaka
    $vehicles = Read-Vehicles
    $known = $null
    if ($vehicles.PSObject.Properties.Name -contains $plaka) {
        $known = $vehicles.$plaka
    }

    if (-not $vehicleId -and $known) { $vehicleId = [string]$known.vehicleId }
    if (-not $hatId -and $known) { $hatId = [string]$known.hatId }
    if (-not $date) { $date = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd") }

    if (-not $vehicleId -or -not $hatId) {
        throw "Bu plaka kayitli degil. VehicleId ve HatId girmen gerekiyor (ornek: 9661 / 512)."
    }

    $url = "https://3cmobil.com.tr/AD_AracbazliRapor.aspx?VehicleId=$vehicleId&HatId=$hatId&EndDate=$date&Plaka=$plaka"
    $client = New-Object System.Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(30)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd("RotarHesaplayici/1.0")
    try {
        $html = $client.GetStringAsync($url).GetAwaiter().GetResult()
    }
    finally {
        $client.Dispose()
    }

    if ($html -notmatch "ltrAracRapor" -and $html -notmatch "Sefer") {
        throw "Rapor HTML'i beklenen tablolari icermiyor. VehicleId/HatId/tarih kontrol et."
    }

    $parsed = Parse-ReportHtml $html
    $parsed = Add-DelayCalculations $parsed
    $parsed.plaka = $plaka
    $parsed.vehicleId = $vehicleId
    $parsed.hatId = $hatId
    $parsed.tarih = $date
    $parsed.kaynakUrl = $url
    if ($known -and $known.kod -and -not $parsed.kod) { $parsed.kod = $known.kod }
    return $parsed
}

function Send-Response($res, [int]$status, [string]$contentType, [byte[]]$bytes) {
    $res.StatusCode = $status
    $res.ContentType = $contentType
    $res.ContentLength64 = $bytes.Length
    $res.Headers["Cache-Control"] = "no-store"
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.OutputStream.Close()
}

function Send-Json($res, $obj, [int]$status = 200) {
    $json = $obj | ConvertTo-Json -Depth 12 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Send-Response $res $status "application/json; charset=utf-8" $bytes
}

function Send-Text($res, [int]$status, [string]$text, [string]$contentType = "text/plain; charset=utf-8") {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    Send-Response $res $status $contentType $bytes
}

function Get-Mime([string]$path) {
    switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
        ".html" { "text/html; charset=utf-8" }
        ".css" { "text/css; charset=utf-8" }
        ".js" { "application/javascript; charset=utf-8" }
        ".json" { "application/json; charset=utf-8" }
        ".svg" { "image/svg+xml" }
        ".ico" { "image/x-icon" }
        default { "application/octet-stream" }
    }
}

if (-not [System.Net.HttpListener]::IsSupported) {
    throw "HttpListener bu sistemde desteklenmiyor."
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefix)
try {
    $listener.Start()
}
catch {
    Write-Host "Port $Port acilamadi. Baska bir program kullaniyor olabilir."
    throw
}

Write-Host "Rötar hesaplayici: $Prefix"
Start-Process $Prefix

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        $path = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
        if ($path -eq "/") { $path = "/index.html" }

        if ($path -eq "/api/vehicles" -and $req.HttpMethod -eq "GET") {
            Send-Json $res (Read-Vehicles)
            continue
        }

        if ($path -eq "/api/vehicles" -and $req.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
            $body = $reader.ReadToEnd()
            $incoming = $body | ConvertFrom-Json
            $plaka = Normalize-Plaka $incoming.plaka
            if (-not $plaka -or -not $incoming.vehicleId -or -not $incoming.hatId) {
                Send-Json $res @{ error = "plaka, vehicleId ve hatId gerekli" } 400
                continue
            }
            $all = Read-Vehicles
            $entry = [ordered]@{
                plaka     = $plaka
                vehicleId = [string]$incoming.vehicleId
                hatId     = [string]$incoming.hatId
                kod       = [string]$incoming.kod
                hatAdi    = [string]$incoming.hatAdi
            }
            if ($all -is [PSCustomObject]) {
                $all | Add-Member -NotePropertyName $plaka -NotePropertyValue $entry -Force
            }
            else {
                $all[$plaka] = $entry
            }
            Save-Vehicles $all
            Send-Json $res $entry
            continue
        }

        if ($path -eq "/api/report" -and $req.HttpMethod -eq "GET") {
            $plaka = $req.QueryString["plaka"]
            $date = $req.QueryString["date"]
            $vehicleId = $req.QueryString["vehicleId"]
            $hatId = $req.QueryString["hatId"]
            try {
                $data = Get-Report $plaka $date $vehicleId $hatId
                Send-Json $res $data
            }
            catch {
                Send-Json $res @{ error = $_.Exception.Message } 400
            }
            continue
        }

        $safeRel = $path.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
        $file = Join-Path $PublicDir $safeRel
        $fullPublic = [IO.Path]::GetFullPath($PublicDir)
        $fullFile = [IO.Path]::GetFullPath($file)
        if (-not $fullFile.StartsWith($fullPublic)) {
            Send-Text $res 403 "Forbidden"
            continue
        }
        if (Test-Path $fullFile -PathType Leaf) {
            $bytes = [IO.File]::ReadAllBytes($fullFile)
            Send-Response $res 200 (Get-Mime $fullFile) $bytes
        }
        else {
            Send-Text $res 404 "Not found"
        }
    }
    catch {
        try { Send-Json $res @{ error = $_.Exception.Message } 500 } catch {}
    }
}
