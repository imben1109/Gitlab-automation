# Pester tests for scripts/gitlab-automation.ps1
# Requires: PowerShell >= 5.1, Pester >= 5.0
#
# Run:
#   Invoke-Pester -Path tests/powershell/gitlab-automation.Tests.ps1 -Output Detailed

BeforeAll {
    $ScriptPath = (Resolve-Path "$PSScriptRoot/../../scripts/gitlab-automation.ps1").Path

    # Extract ConvertTo-Slug from the script for pure unit testing.
    # We read the function definition from the script rather than running the
    # whole script, so there are no side-effects.
    $ScriptContent  = Get-Content $ScriptPath -Raw
    $FuncMatch      = ([regex]'(?ms)function ConvertTo-Slug \{.+?\n\}').Match($ScriptContent)
    if (-not $FuncMatch.Success) { throw 'Could not extract ConvertTo-Slug from script' }
    Invoke-Expression $FuncMatch.Value

    # Helper: run the script as a subprocess and return an object with
    # ExitCode and CombinedOutput.
    #
    # PATH is restricted to /usr/bin:/bin so that `node` (at /usr/local/bin)
    # is not found; this forces the PS script into its pure-PowerShell fallback
    # path rather than delegating to the Node CLI.
    function Invoke-Script {
        param(
            [hashtable]$Env      = @{},
            [int]$IssueNumber    = 42,
            [switch]$AutoConfirm
        )
        $psArgs = @('-NoProfile', '-NonInteractive', '-File', $ScriptPath,
                    '-IssueNumber', $IssueNumber)
        if ($AutoConfirm) { $psArgs += '-AutoConfirm' }

        $psi = [System.Diagnostics.ProcessStartInfo]::new('pwsh', $psArgs)
        $psi.UseShellExecute        = $false
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError  = $true

        # Propagate existing env, then override with caller-supplied values.
        foreach ($key in [System.Environment]::GetEnvironmentVariables().Keys) {
            $psi.EnvironmentVariables[$key] = [System.Environment]::GetEnvironmentVariable($key)
        }
        foreach ($pair in $Env.GetEnumerator()) {
            $psi.EnvironmentVariables[$pair.Key] = $pair.Value
        }

        # Restrict PATH so node is not found, preventing delegation to the
        # Node CLI and keeping tests in the PowerShell-only fallback branch.
        $psi.EnvironmentVariables['PATH'] = '/usr/bin:/bin'

        $proc = [System.Diagnostics.Process]::Start($psi)
        $stdout = $proc.StandardOutput.ReadToEnd()
        $stderr = $proc.StandardError.ReadToEnd()
        $proc.WaitForExit()
        [PSCustomObject]@{
            ExitCode       = $proc.ExitCode
            CombinedOutput = "$stdout`n$stderr".Trim()
        }
    }

    # Base env vars that every integration test starts from.
    $BaseEnv = @{
        GITLAB_URL        = 'https://gitlab.example.com'
        GITLAB_TOKEN      = 'test-gl-token'
        GITLAB_PROJECT_ID = 'mygroup/myproject'
        GITHUB_TOKEN      = 'test-gh-token'
    }
}

# ── ConvertTo-Slug unit tests ─────────────────────────────────────────────────

Describe 'ConvertTo-Slug' {
    It 'lowercases input' {
        ConvertTo-Slug 'Hello World' | Should -Be 'hello-world'
    }

    It 'replaces spaces with hyphens' {
        ConvertTo-Slug 'fix the login bug' | Should -Be 'fix-the-login-bug'
    }

    It 'removes special characters' {
        ConvertTo-Slug 'Fix: bug!' | Should -Be 'fix-bug'
    }

    It 'handles numeric characters' {
        ConvertTo-Slug 'Issue 42 Fix' | Should -Be 'issue-42-fix'
    }

    It 'returns empty string for all-special input' {
        ConvertTo-Slug '!!!@@@###' | Should -Be ''
    }

    It 'collapses multiple spaces' {
        ConvertTo-Slug 'fix  the  bug' | Should -Be 'fix-the-bug'
    }

    It 'trims leading and trailing hyphens' {
        ConvertTo-Slug '-fix-bug-' | Should -Be 'fix-bug'
    }
}

# ── Environment variable validation ──────────────────────────────────────────

Describe 'Environment variable validation' {
    It 'exits with non-zero when GITLAB_TOKEN is missing' {
        $env = $BaseEnv.Clone(); $env.Remove('GITLAB_TOKEN')
        $result = Invoke-Script -Env $env
        $result.ExitCode | Should -Not -Be 0
    }

    It 'prints GITLAB_TOKEN in error output when it is missing' {
        $env = $BaseEnv.Clone(); $env.Remove('GITLAB_TOKEN')
        $result = Invoke-Script -Env $env
        $result.CombinedOutput | Should -Match 'GITLAB_TOKEN'
    }

    It 'exits with non-zero when GITLAB_PROJECT_ID is missing' {
        $env = $BaseEnv.Clone(); $env.Remove('GITLAB_PROJECT_ID')
        $result = Invoke-Script -Env $env
        $result.ExitCode | Should -Not -Be 0
    }

    It 'prints GITLAB_PROJECT_ID in error output when it is missing' {
        $env = $BaseEnv.Clone(); $env.Remove('GITLAB_PROJECT_ID')
        $result = Invoke-Script -Env $env
        $result.CombinedOutput | Should -Match 'GITLAB_PROJECT_ID'
    }
}

# ── Integration tests (Node.js mock HTTP server) ─────────────────────────────

Describe 'Integration — full workflow' {
    BeforeAll {
        $script:MockPort = 19243

        # Resolve node binary path at runtime so the tests are portable across
        # different OS / install locations (macOS Homebrew, Windows nvm, etc.).
        $script:NodeExe = (Get-Command node -ErrorAction Stop).Source

        # Write a minimal Node.js HTTP server that mocks the GitLab REST API.
        # We use Node (not System.Net.HttpListener) because it is reliably
        # available on the CI runner and starts in < 1 second.
        $serverJs = @"
const http = require('http');
const p = $($script:MockPort);
http.createServer((req, res) => {
  const u = req.url;
  res.setHeader('Content-Type', 'application/json');
  if (/\/issues\/\d+/.test(u))
    res.end(JSON.stringify({id:1,iid:42,title:'Fix navbar',description:'Broken on mobile',web_url:'http://localhost:'+p+'/g/p/-/issues/42'}));
  else if (u.includes('/repository/branches'))
    res.end(JSON.stringify({name:'issue-42-fix-navbar',commit:{id:'abc123'}}));
  else if (u.includes('/merge_requests'))
    res.end(JSON.stringify({iid:1,web_url:'http://localhost:'+p+'/g/p/-/merge_requests/1'}));
  else
    res.end('{}');
}).listen(p, '127.0.0.1');
"@
        $script:MockServerFile = [System.IO.Path]::GetTempFileName() + '.js'
        Set-Content $script:MockServerFile $serverJs -Encoding UTF8
        $script:MockServerProc = Start-Process -FilePath $script:NodeExe `
            -ArgumentList $script:MockServerFile -PassThru -NoNewWindow
        Start-Sleep -Milliseconds 800  # Give Node time to start listening

        $script:MockEnv = @{
            GITLAB_URL        = "http://localhost:$($script:MockPort)"
            GITLAB_TOKEN      = 'test-gl-token'
            GITLAB_PROJECT_ID = 'mygroup/myproject'
            GITHUB_TOKEN      = 'test-gh-token'
        }
    }

    AfterAll {
        if ($script:MockServerProc -and -not $script:MockServerProc.HasExited) {
            $script:MockServerProc.Kill()
        }
        Remove-Item $script:MockServerFile -Force -ErrorAction SilentlyContinue
    }

    It 'exits 0 on a successful end-to-end workflow (fallback mode)' {
        $result = Invoke-Script -Env $script:MockEnv -AutoConfirm
        $result.ExitCode | Should -Be 0
    }

    It 'prints an INFO message for fetching the issue' {
        $result = Invoke-Script -Env $script:MockEnv -AutoConfirm
        $result.CombinedOutput | Should -Match 'Fetching issue'
    }

    It 'prints the Merge Request URL after creation' {
        $result = Invoke-Script -Env $script:MockEnv -AutoConfirm
        $result.CombinedOutput | Should -Match 'Merge Request'
    }

    It 'derives correct branch name from issue iid and title' {
        $result = Invoke-Script -Env $script:MockEnv -AutoConfirm
        $result.CombinedOutput | Should -Match 'issue-42-fix-navbar'
    }

    It 'reports branch-already-exists gracefully' {
        $port2 = 19244

        # Second mock server: returns 422 "already exists" for branch creation.
        $serverJs2 = @"
const http = require('http');
const p = $port2;
http.createServer((req, res) => {
  const u = req.url;
  res.setHeader('Content-Type', 'application/json');
  if (/\/issues\/\d+/.test(u))
    res.end(JSON.stringify({id:1,iid:42,title:'Fix navbar',description:'',web_url:'http://localhost:'+p+'/g/p/-/issues/42'}));
  else if (u.includes('/repository/branches')) {
    res.statusCode = 422;
    res.end(JSON.stringify({message:{branch:['already exists']}}));
  } else if (u.includes('/merge_requests'))
    res.end(JSON.stringify({iid:1,web_url:'http://localhost:'+p+'/mr/1'}));
  else
    res.end('{}');
}).listen(p, '127.0.0.1');
"@
        $serverFile2 = [System.IO.Path]::GetTempFileName() + '.js'
        Set-Content $serverFile2 $serverJs2 -Encoding UTF8
        $proc2 = Start-Process -FilePath $script:NodeExe `
            -ArgumentList $serverFile2 -PassThru -NoNewWindow
        Start-Sleep -Milliseconds 800

        try {
            $env2 = $script:MockEnv.Clone()
            $env2['GITLAB_URL'] = "http://localhost:$port2"
            $result = Invoke-Script -Env $env2 -AutoConfirm
            # Script should continue past the "already exists" error
            $result.CombinedOutput | Should -Match 'already exists|Merge Request'
        } finally {
            if (-not $proc2.HasExited) { $proc2.Kill() }
            Remove-Item $serverFile2 -Force -ErrorAction SilentlyContinue
        }
    }
}
