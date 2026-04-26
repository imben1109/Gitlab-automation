#Requires -Version 5.1
<#
.SYNOPSIS
    GitLab Issue Automation — Human-in-the-loop PowerShell standalone script.
.DESCRIPTION
    Two-step workflow:
      start  — Fetch the issue, verify main is up-to-date, create a feature branch,
               and export the issue to a Markdown file for planning.
      finish — Commit your changes and open a GitLab Merge Request.
.PARAMETER Command
    'start' or 'finish' (mandatory).
.PARAMETER IssueNumber
    The GitLab issue number to process (mandatory).
.EXAMPLE
    ./gitlab-automation.ps1 -Command start  -IssueNumber 42
.EXAMPLE
    ./gitlab-automation.ps1 -Command finish -IssueNumber 42
#>
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('start', 'finish')]
    [string]$Command,

    [Parameter(Mandatory = $true)]
    [int]$IssueNumber
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

if (-not $GitLabToken)     { Fail "Missing environment variable: GITLAB_TOKEN" }
if (-not $GitLabProjectId) { Fail "Missing environment variable: GITLAB_PROJECT_ID" }

$GitLabUrl      = $GitLabUrl.TrimEnd('/')
$EncodedProject = [Uri]::EscapeDataString($GitLabProjectId)
$ApiBase        = "$GitLabUrl/api/v4"

$Headers = @{
    'PRIVATE-TOKEN' = $GitLabToken
    'Content-Type'  = 'application/json'
}

# ── shared: fetch issue ───────────────────────────────────────────────────────

Write-Info "Fetching issue #$IssueNumber from GitLab..."
try {
    $Issue = Invoke-RestMethod -Uri "$ApiBase/projects/$EncodedProject/issues/$IssueNumber" `
                               -Headers $Headers -Method Get
} catch {
    Fail "Failed to fetch issue #${IssueNumber}: $_"
}
Write-Ok "Issue: $($Issue.title)"

$BranchName = "issue-$($Issue.iid)-$(ConvertTo-Slug $Issue.title)"
Write-Info "Branch name: $BranchName"

# ── command: start ────────────────────────────────────────────────────────────

if ($Command -eq 'start') {

    # Verify local repo is on main and up-to-date (best-effort: git failures are warnings, not errors)
    try {
        $null = & git rev-parse --is-inside-work-tree 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Not inside a git work tree; skipping branch verification."
        } else {
            $CurrentBranch = (& git rev-parse --abbrev-ref HEAD 2>&1).Trim()
            if ($LASTEXITCODE -ne 0) {
                Write-Warn "Could not determine current branch; skipping branch verification."
            } elseif ($CurrentBranch -ne 'main') {
                Fail "Expected to be on 'main' branch, but currently on '$CurrentBranch'. Switch to main before starting."
            } else {
                Write-Info "Fetching latest changes from origin/main..."
                & git fetch origin main 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Warn "git fetch failed; skipping 'behind origin/main' check."
                } else {
                    $BehindText = (& git rev-list --count HEAD..origin/main 2>&1).Trim()
                    if ($LASTEXITCODE -ne 0) {
                        Write-Warn "Could not compute behind count; skipping behind check."
                    } else {
                        $Behind = [int]$BehindText
                        if ($Behind -gt 0) {
                            Fail "Local main is $Behind commit(s) behind origin/main. Please run 'git pull' before starting."
                        }
                        Write-Ok "On main and up-to-date with origin."
                    }
                }
            }
        }
    } catch {
        Write-Warn "git verification step failed; skipping. Details: $($_.Exception.Message)"
    }

    # Create branch via GitLab API
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

    # Checkout branch locally
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
        Write-Warn "Could not checkout branch locally."
    }

    # Export issue to Markdown file
    $MarkdownFile = "issue-$($Issue.iid).md"
    $IssueDesc    = if ($Issue.description) { $Issue.description } else { '_No description provided._' }
    $MarkdownContent = @"
# Issue #$($Issue.iid): $($Issue.title)

**URL:** $($Issue.web_url)
**Branch:** $BranchName

## Description

$IssueDesc

## Planning

<!-- Add your implementation plan here -->

## Progress

- [ ] Add your first task here
"@
    Set-Content -Path $MarkdownFile -Value $MarkdownContent -Encoding UTF8
    Write-Ok "Issue exported to $MarkdownFile"

    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Review and update $MarkdownFile" -ForegroundColor Cyan
    Write-Host "  2. Make your changes in the codebase" -ForegroundColor Cyan
    Write-Host "  3. Run: ./gitlab-automation.ps1 -Command finish -IssueNumber $IssueNumber" -ForegroundColor Cyan
}

# ── command: finish ───────────────────────────────────────────────────────────

if ($Command -eq 'finish') {

    # Commit and push
    Write-Info "Committing and pushing changes..."
    & git add . 2>&1 | Out-Null
    $CommitMsg = "feat: issue #$($Issue.iid) - $($Issue.title)"
    & git commit -m $CommitMsg 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Nothing to commit. Make your changes before running finish." }
    & git push origin $BranchName --set-upstream 2>&1
    if ($LASTEXITCODE -ne 0) { Fail "Failed to push branch $BranchName to origin." }
    Write-Ok "Changes committed and pushed."

    # Create Merge Request
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
}
