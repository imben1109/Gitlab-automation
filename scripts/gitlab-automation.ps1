#Requires -Version 5.1
<#
.SYNOPSIS
    GitLab Issue Automation — PowerShell standalone script.
.DESCRIPTION
    Fetches a GitLab issue, creates a branch, optionally calls Node.js for
    Copilot planning, and creates a Merge Request — all via the GitLab REST API.
.PARAMETER IssueNumber
    The GitLab issue number to process (mandatory).
.PARAMETER AutoConfirm
    Skip the confirmation prompt when calling the Node.js CLI.
.EXAMPLE
    ./gitlab-automation.ps1 -IssueNumber 42
.EXAMPLE
    ./gitlab-automation.ps1 -IssueNumber 42 -AutoConfirm
#>
param(
    [Parameter(Mandatory = $true)]
    [int]$IssueNumber,

    [switch]$AutoConfirm
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── helpers ──────────────────────────────────────────────────────────────────

function Write-Info  { param([string]$Msg) Write-Host "INFO:  $Msg" -ForegroundColor Cyan   }
function Write-Ok    { param([string]$Msg) Write-Host "OK:    $Msg" -ForegroundColor Green  }
function Write-Warn  { param([string]$Msg) Write-Host "WARN:  $Msg" -ForegroundColor Yellow }
function Fail        { param([string]$Msg) Write-Error "ERROR: $Msg"; exit 1 }

function ConvertTo-Slug {
    param([string]$Text)
    $slug = $Text.ToLower()
    $slug = $slug -replace '[^a-z0-9\s-]', ''
    $slug = $slug.Trim()
    $slug = $slug -replace '[\s-]+', '-'
    $slug = $slug.Trim('-')
    return $slug
}

# ── read env vars ─────────────────────────────────────────────────────────────

$GitLabUrl       = if ($env:GITLAB_URL) { $env:GITLAB_URL } else { 'https://gitlab.com' }
$GitLabToken     = $env:GITLAB_TOKEN
$GitLabProjectId = $env:GITLAB_PROJECT_ID
$GitHubToken     = $env:GITHUB_TOKEN

if (-not $GitLabToken)     { Fail "Missing environment variable: GITLAB_TOKEN" }
if (-not $GitLabProjectId) { Fail "Missing environment variable: GITLAB_PROJECT_ID" }
if (-not $GitHubToken)     { Fail "Missing environment variable: GITHUB_TOKEN" }

$GitLabUrl = $GitLabUrl.TrimEnd('/')
$EncodedProject = [Uri]::EscapeDataString($GitLabProjectId)
$ApiBase = "$GitLabUrl/api/v4"

$Headers = @{
    'PRIVATE-TOKEN' = $GitLabToken
    'Content-Type'  = 'application/json'
}

# ── fetch issue ───────────────────────────────────────────────────────────────

Write-Info "Fetching issue #$IssueNumber from GitLab..."
try {
    $Issue = Invoke-RestMethod -Uri "$ApiBase/projects/$EncodedProject/issues/$IssueNumber" `
                               -Headers $Headers -Method Get
} catch {
    Fail "Failed to fetch issue #${IssueNumber}: $_"
}

Write-Ok "Issue: $($Issue.title)"

# ── build branch name ─────────────────────────────────────────────────────────

$BranchName = "issue-$($Issue.iid)-$(ConvertTo-Slug $Issue.title)"
Write-Info "Branch name: $BranchName"

# ── create branch via GitLab API ──────────────────────────────────────────────

Write-Info "Creating branch on GitLab..."
try {
    $BranchBody = @{ branch = $BranchName; ref = 'main' } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "$ApiBase/projects/$EncodedProject/repository/branches" `
                              -Headers $Headers -Method Post -Body $BranchBody
    Write-Ok "Branch created: $BranchName"
} catch {
    $ErrMsg = $_.Exception.Message
    if ($ErrMsg -match 'already exists' -or ($_.ErrorDetails.Message -match 'already exists')) {
        Write-Warn "Branch already exists, continuing..."
    } else {
        Fail "Failed to create branch: $ErrMsg"
    }
}

# ── local git checkout ────────────────────────────────────────────────────────

try {
    $null = & git rev-parse --is-inside-work-tree 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Checking out branch locally..."
        & git checkout -b $BranchName 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Branch may already exist locally, skipping checkout."
        } else {
            Write-Ok "Checked out: $BranchName"
        }
    }
} catch {
    Write-Warn "git not found or not in a git repository."
}

# ── delegate to Node.js if available ─────────────────────────────────────────

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeEntry  = Join-Path $ScriptDir '..\bin\gitlab-auto.js'

$NodeExists = $null -ne (Get-Command 'node' -ErrorAction SilentlyContinue)
if ($NodeExists -and (Test-Path $NodeEntry)) {
    Write-Info "Node.js found — delegating to gitlab-auto.js..."
    $NodeArgs = @($IssueNumber)
    if ($AutoConfirm) { $NodeArgs += '--auto-confirm' }
    & node $NodeEntry @NodeArgs
    exit $LASTEXITCODE
}

Write-Warn "Node.js not found — performing minimal workflow (no Copilot plan)."

# ── fallback: create MR via Invoke-RestMethod ─────────────────────────────────

Write-Info "Creating Merge Request on GitLab..."
$MrBody = @{
    title         = "Issue #$($Issue.iid): $($Issue.title)"
    description   = "Related issue: $($Issue.web_url)"
    source_branch = $BranchName
    target_branch = 'main'
} | ConvertTo-Json

try {
    $MR = Invoke-RestMethod -Uri "$ApiBase/projects/$EncodedProject/merge_requests" `
                            -Headers $Headers -Method Post -Body $MrBody
    Write-Ok "Merge Request created: $($MR.web_url)"
} catch {
    Fail "Failed to create Merge Request: $_"
}
