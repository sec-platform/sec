$ErrorActionPreference = "SilentlyContinue"

$patterns = @("graph-it-live", "n8n-mcp")

$allZombies = @()

foreach ($pattern in $patterns) {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { 
        $_.CommandLine -match $pattern 
    }
    if ($procs) {
        Write-Host "Found $($procs.Count) $pattern zombie process(es). Killing..."
        $procs | ForEach-Object { 
            Stop-Process -Id $_.ProcessId -Force
            Write-Host "  Killed PID: $($_.ProcessId) ($pattern)"
        }
        $allZombies += $procs
    }
}

if ($allZombies.Count -eq 0) {
    Write-Host "No MCP zombie processes found."
} else {
    Write-Host "`nCleanup complete: $($allZombies.Count) zombie processes killed."
}
