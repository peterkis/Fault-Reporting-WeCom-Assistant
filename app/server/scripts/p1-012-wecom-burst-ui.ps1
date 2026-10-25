[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TokenBase,

    [Parameter(Mandatory)]
    [string]$MentionSearchText,

    [int]$StartIndex = 1,

    [int]$EndIndex = 100,

    [int]$StepDelayMs = 50,

    [int]$MentionMenuDelayMs = 120,

    [int]$MentionSelectionDelayMs = 600,

    [int]$MentionDownPresses = 1,

    [int]$InterMessageDelayMs = 180,

    [int]$ArmDelaySeconds = 5,

    [double]$ComposerXRatio = 0.55,

    [double]$ComposerYRatio = 0.78,

    [string]$MessageBody = '新报修：P1-012群内突发验证，测试终端无法登录，请处理。',

    [switch]$PlanOnly,

    [switch]$Execute
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:CompletedCount = 0
$script:CurrentSequence = $null
$script:CurrentPhase = 'NOT_STARTED'
$script:CursorCaptured = $false
$script:OriginalCursor = $null
$script:ClipboardCaptured = $false
$script:OriginalClipboard = $null
$script:OriginalClipboardWasEmpty = $false

function New-P1012Error {
    param([string]$Code)

    return [InvalidOperationException]::new($Code)
}

function Write-P1012Event {
    param([System.Collections.IDictionary]$Record)

    $Record | ConvertTo-Json -Depth 6 -Compress
}

function Get-P1012ErrorCode {
    param([System.Exception]$Exception)

    if ($Exception.Message -match '^P1_012_[A-Z0-9_]+$') {
        return $Exception.Message
    }
    return 'P1_012_UI_AUTOMATION_FAILED'
}

function Assert-P1012Arguments {
    if ($PlanOnly.IsPresent -eq $Execute.IsPresent) {
        throw (New-P1012Error -Code 'P1_012_UI_MODE_REQUIRED')
    }
    if (-not [regex]::IsMatch($TokenBase, '\A[A-Za-z0-9_.:-]{6,120}\z')) {
        throw (New-P1012Error -Code 'P1_012_UI_TOKEN_INVALID')
    }
    if ([string]::IsNullOrWhiteSpace($MentionSearchText) -or
        $MentionSearchText.Length -gt 40 -or
        $MentionSearchText.Contains('@') -or
        $MentionSearchText.ToCharArray().Where({ [char]::IsControl($_) }).Count -gt 0) {
        throw (New-P1012Error -Code 'P1_012_UI_MENTION_SEARCH_INVALID')
    }
    if ([string]::IsNullOrWhiteSpace($MessageBody) -or
        $MessageBody.Length -gt 160 -or
        $MessageBody.ToCharArray().Where({ [char]::IsControl($_) }).Count -gt 0) {
        throw (New-P1012Error -Code 'P1_012_UI_MESSAGE_BODY_INVALID')
    }
    if ($StartIndex -lt 1 -or $StartIndex -gt 100 -or
        $EndIndex -lt 1 -or $EndIndex -gt 100 -or
        $StartIndex -gt $EndIndex) {
        throw (New-P1012Error -Code 'P1_012_UI_RANGE_INVALID')
    }
    if ($StepDelayMs -lt 25 -or $StepDelayMs -gt 1000 -or
        $MentionMenuDelayMs -lt 75 -or $MentionMenuDelayMs -gt 2000 -or
        $MentionSelectionDelayMs -lt 200 -or $MentionSelectionDelayMs -gt 2000 -or
        $MentionDownPresses -lt 0 -or $MentionDownPresses -gt 5 -or
        $InterMessageDelayMs -lt 100 -or $InterMessageDelayMs -gt 5000 -or
        $ArmDelaySeconds -lt 1 -or $ArmDelaySeconds -gt 15) {
        throw (New-P1012Error -Code 'P1_012_UI_TIMING_INVALID')
    }
    if ($ComposerXRatio -lt 0.40 -or $ComposerXRatio -gt 0.70 -or
        $ComposerYRatio -lt 0.60 -or $ComposerYRatio -gt 0.90) {
        throw (New-P1012Error -Code 'P1_012_UI_COMPOSER_POINT_INVALID')
    }
}

function Test-P1012EscapePressed {
    return (([P1012WeComBurstNative]::GetAsyncKeyState(0x1B) -band 0x8000) -ne 0)
}

function Wait-P1012Cancellable {
    param([int]$Milliseconds)

    $remaining = $Milliseconds
    while ($remaining -gt 0) {
        if (Test-P1012EscapePressed) {
            throw (New-P1012Error -Code 'P1_012_UI_CANCELLED')
        }
        $slice = [Math]::Min(25, $remaining)
        Start-Sleep -Milliseconds $slice
        $remaining -= $slice
    }
}

function Assert-P1012TargetForeground {
    param([IntPtr]$TargetWindow)

    if (([P1012WeComBurstNative]::GetForegroundWindow()) -ne $TargetWindow) {
        throw (New-P1012Error -Code 'P1_012_UI_FOCUS_LOST')
    }
}

function Send-P1012Keys {
    param(
        [IntPtr]$TargetWindow,
        [string]$Keys,
        [string]$PhaseAfter
    )

    if (Test-P1012EscapePressed) {
        throw (New-P1012Error -Code 'P1_012_UI_CANCELLED')
    }
    Assert-P1012TargetForeground -TargetWindow $TargetWindow
    [System.Windows.Forms.SendKeys]::SendWait($Keys)
    $script:CurrentPhase = $PhaseAfter
    Wait-P1012Cancellable -Milliseconds $StepDelayMs
    Assert-P1012TargetForeground -TargetWindow $TargetWindow
}

function Get-P1012TargetProcess {
    $candidates = @(Get-Process -Name 'WXWork' -ErrorAction SilentlyContinue |
        Where-Object {
            $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ceq '企业微信'
        })
    if ($candidates.Count -ne 1) {
        throw (New-P1012Error -Code 'P1_012_UI_TARGET_NOT_UNIQUE')
    }
    return $candidates[0]
}

function Set-P1012ComposerFocus {
    param([IntPtr]$TargetWindow)

    if (-not [P1012WeComBurstNative]::SetForegroundWindow($TargetWindow)) {
        throw (New-P1012Error -Code 'P1_012_UI_ACTIVATION_FAILED')
    }
    Wait-P1012Cancellable -Milliseconds 150
    Assert-P1012TargetForeground -TargetWindow $TargetWindow

    $clientRect = [P1012WeComBurstNative+RECT]::new()
    if (-not [P1012WeComBurstNative]::GetClientRect($TargetWindow, [ref]$clientRect)) {
        throw (New-P1012Error -Code 'P1_012_UI_CLIENT_RECT_FAILED')
    }
    $width = $clientRect.Right - $clientRect.Left
    $height = $clientRect.Bottom - $clientRect.Top
    if ($width -lt 800 -or $height -lt 600) {
        throw (New-P1012Error -Code 'P1_012_UI_WINDOW_TOO_SMALL')
    }

    $point = [P1012WeComBurstNative+POINT]::new()
    $point.X = [int][Math]::Round($width * $ComposerXRatio)
    $point.Y = [int][Math]::Round($height * $ComposerYRatio)
    if (-not [P1012WeComBurstNative]::ClientToScreen($TargetWindow, [ref]$point)) {
        throw (New-P1012Error -Code 'P1_012_UI_CLIENT_POINT_FAILED')
    }
    if (-not [P1012WeComBurstNative]::SetCursorPos($point.X, $point.Y)) {
        throw (New-P1012Error -Code 'P1_012_UI_CURSOR_FAILED')
    }
    [P1012WeComBurstNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [P1012WeComBurstNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    $script:CurrentPhase = 'COMPOSER_CLICKED'
    Wait-P1012Cancellable -Milliseconds $StepDelayMs
    Assert-P1012TargetForeground -TargetWindow $TargetWindow
}

function Set-P1012ClipboardText {
    param([string]$Text)

    for ($attempt = 1; $attempt -le 5; $attempt += 1) {
        try {
            [System.Windows.Forms.Clipboard]::SetText($Text)
            return
        }
        catch {
            if ($attempt -eq 5) {
                throw (New-P1012Error -Code 'P1_012_UI_CLIPBOARD_BUSY')
            }
            Start-Sleep -Milliseconds 25
        }
    }
}

function Restore-P1012Clipboard {
    if (-not $script:ClipboardCaptured) {
        return
    }
    try {
        if ($script:OriginalClipboardWasEmpty) {
            [System.Windows.Forms.Clipboard]::Clear()
        }
        else {
            [System.Windows.Forms.Clipboard]::SetDataObject($script:OriginalClipboard, $true)
        }
    }
    catch {
        throw (New-P1012Error -Code 'P1_012_UI_CLIPBOARD_RESTORE_FAILED')
    }
    finally {
        $script:ClipboardCaptured = $false
    }
}

function Assert-P1012ComposerEmpty {
    param([IntPtr]$TargetWindow)

    $emptyMarker = "P1012-EMPTY-CHECK-$([Guid]::NewGuid().ToString('N'))"
    Set-P1012ClipboardText -Text $emptyMarker
    Send-P1012Keys -TargetWindow $TargetWindow -Keys '^a' -PhaseAfter 'COMPOSER_SELECTED_FOR_EMPTY_CHECK'
    Send-P1012Keys -TargetWindow $TargetWindow -Keys '^c' -PhaseAfter 'COMPOSER_COPIED_FOR_EMPTY_CHECK'
    $observed = [System.Windows.Forms.Clipboard]::GetText()
    if (-not $observed.Equals($emptyMarker, [StringComparison]::Ordinal)) {
        throw (New-P1012Error -Code 'P1_012_UI_COMPOSER_NOT_EMPTY')
    }

    $editorMarker = "P1012-EDITOR-CHECK-$([Guid]::NewGuid().ToString('N'))"
    Set-P1012ClipboardText -Text $editorMarker
    Send-P1012Keys -TargetWindow $TargetWindow -Keys '^v' -PhaseAfter 'COMPOSER_PROBE_PASTED'
    $copyMarker = "P1012-COPY-CHECK-$([Guid]::NewGuid().ToString('N'))"
    Set-P1012ClipboardText -Text $copyMarker
    Send-P1012Keys -TargetWindow $TargetWindow -Keys '^a' -PhaseAfter 'COMPOSER_PROBE_SELECTED'
    Send-P1012Keys -TargetWindow $TargetWindow -Keys '^c' -PhaseAfter 'COMPOSER_PROBE_COPIED'
    $copiedProbe = [System.Windows.Forms.Clipboard]::GetText()
    if (-not $copiedProbe.Equals($editorMarker, [StringComparison]::Ordinal)) {
        throw (New-P1012Error -Code 'P1_012_UI_COMPOSER_FOCUS_INVALID')
    }
    Send-P1012Keys -TargetWindow $TargetWindow -Keys '{BACKSPACE}' -PhaseAfter 'COMPOSER_PROBE_CLEARED'
}

$nativeSource = @'
using System;
using System.Runtime.InteropServices;

public static class P1012WeComBurstNative
{
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
'@

$exitCode = 0
try {
    Assert-P1012Arguments
    $count = $EndIndex - $StartIndex + 1

    if ($PlanOnly) {
        Write-P1012Event -Record ([ordered]@{
            test_id = 'P1-012'
            event = 'p1_012_wecom_ui_burst_plan'
            mode = 'PLAN_ONLY'
            start_index = $StartIndex
            end_index = $EndIndex
            count = $count
            first_sequence = $StartIndex.ToString('000')
            last_sequence = $EndIndex.ToString('000')
            step_delay_ms = $StepDelayMs
            mention_menu_delay_ms = $MentionMenuDelayMs
            mention_selection_delay_ms = $MentionSelectionDelayMs
            mention_down_presses = $MentionDownPresses
            inter_message_delay_ms = $InterMessageDelayMs
            arm_delay_seconds = $ArmDelaySeconds
            native_mention_strategy = 'AT_SEARCH_SELECT_EACH_MESSAGE'
            composer_refocus_after_mention = $true
            external_side_effect = $false
            expected_reconciliation_event = 'p1_012_live_burst_result'
        })
    }
    else {
        if (-not $IsWindows) {
            throw (New-P1012Error -Code 'P1_012_UI_WINDOWS_REQUIRED')
        }
        if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
            throw (New-P1012Error -Code 'P1_012_UI_STA_REQUIRED')
        }

        Add-Type -AssemblyName System.Windows.Forms
        if (-not ('P1012WeComBurstNative' -as [type])) {
            Add-Type -TypeDefinition $nativeSource
        }

        $script:OriginalClipboard = [System.Windows.Forms.Clipboard]::GetDataObject()
        $script:OriginalClipboardWasEmpty = $null -eq $script:OriginalClipboard
        $script:ClipboardCaptured = $true

        $cursor = [P1012WeComBurstNative+POINT]::new()
        if ([P1012WeComBurstNative]::GetCursorPos([ref]$cursor)) {
            $script:OriginalCursor = $cursor
            $script:CursorCaptured = $true
        }

        $targetProcess = Get-P1012TargetProcess
        $targetWindow = [IntPtr]$targetProcess.MainWindowHandle
        Write-P1012Event -Record ([ordered]@{
            test_id = 'P1-012'
            event = 'p1_012_wecom_ui_burst_armed'
            mode = 'EXECUTE'
            start_index = $StartIndex
            end_index = $EndIndex
            count = $count
            target_process = 'WXWork'
            exact_window_title_validated = $true
            arm_delay_seconds = $ArmDelaySeconds
            escape_cancels = $true
        })

        Wait-P1012Cancellable -Milliseconds ($ArmDelaySeconds * 1000)
        Set-P1012ComposerFocus -TargetWindow $targetWindow
        Assert-P1012ComposerEmpty -TargetWindow $targetWindow
        Write-P1012Event -Record ([ordered]@{
            test_id = 'P1-012'
            event = 'p1_012_wecom_ui_composer_ready'
            composer_empty = $true
            native_mention_strategy = 'AT_SEARCH_SELECT_EACH_MESSAGE'
            native_mention_requires_callback_reconciliation = $true
            composer_refocus_after_mention = $true
        })

        for ($index = $StartIndex; $index -le $EndIndex; $index += 1) {
            $script:CurrentSequence = $index

            Set-P1012ClipboardText -Text $MentionSearchText
            Send-P1012Keys -TargetWindow $targetWindow -Keys '@' -PhaseAfter 'MENTION_MENU_OPEN_REQUESTED'
            Send-P1012Keys -TargetWindow $targetWindow -Keys '^v' -PhaseAfter 'MENTION_SEARCH_PASTED'
            Wait-P1012Cancellable -Milliseconds $MentionMenuDelayMs
            for ($press = 0; $press -lt $MentionDownPresses; $press += 1) {
                Send-P1012Keys -TargetWindow $targetWindow -Keys '{DOWN}' -PhaseAfter 'MENTION_CANDIDATE_MOVED'
            }
            Send-P1012Keys -TargetWindow $targetWindow -Keys '{ENTER}' -PhaseAfter 'MENTION_SELECTED'
            Wait-P1012Cancellable -Milliseconds $MentionSelectionDelayMs
            Set-P1012ComposerFocus -TargetWindow $targetWindow
            $script:CurrentPhase = 'COMPOSER_REFOCUSED_AFTER_MENTION'

            $sequence = $index.ToString('000')
            Set-P1012ClipboardText -Text " $MessageBody $TokenBase-$sequence"
            Send-P1012Keys -TargetWindow $targetWindow -Keys '^v' -PhaseAfter 'MESSAGE_BODY_PASTED'
            Send-P1012Keys -TargetWindow $targetWindow -Keys '{ENTER}' -PhaseAfter 'ENTER_SENT'
            $script:CompletedCount += 1

            Write-P1012Event -Record ([ordered]@{
                test_id = 'P1-012'
                event = 'p1_012_wecom_ui_message_input_sent'
                sequence_index = $index
                status = 'UI_INPUT_SENT'
                native_mention_selection_input_sent = $true
                callback_or_ticket_proven = $false
            })

            if ($index -lt $EndIndex) {
                $script:CurrentPhase = 'BETWEEN_MESSAGES'
                Wait-P1012Cancellable -Milliseconds $InterMessageDelayMs
            }
        }

        $script:CurrentSequence = $null
        $script:CurrentPhase = 'RESTORING_CLIPBOARD'
        Restore-P1012Clipboard
        $script:CurrentPhase = 'COMPLETE'
        Write-P1012Event -Record ([ordered]@{
            test_id = 'P1-012'
            event = 'p1_012_wecom_ui_burst_complete'
            outcome = 'UI_INPUT_COMPLETED'
            completed_count = $script:CompletedCount
            native_mention_selection_input_sent = $true
            clipboard_restored = $true
            callback_or_ticket_proven = $false
            expected_reconciliation_event = 'p1_012_live_burst_result'
        })
    }
}
catch {
    $errorCode = Get-P1012ErrorCode -Exception $_.Exception
    $cancelled = $errorCode -eq 'P1_012_UI_CANCELLED'
    $partialComposer = $script:CurrentPhase -in @(
        'MENTION_MENU_OPEN_REQUESTED',
        'MENTION_SEARCH_PASTED',
        'MENTION_CANDIDATE_MOVED',
        'MENTION_SELECTED',
        'COMPOSER_REFOCUSED_AFTER_MENTION',
        'MESSAGE_BODY_PASTED',
        'COMPOSER_PROBE_PASTED',
        'COMPOSER_PROBE_SELECTED',
        'COMPOSER_PROBE_COPIED'
    )
    Write-P1012Event -Record ([ordered]@{
        test_id = 'P1-012'
        event = 'p1_012_wecom_ui_burst_stopped'
        outcome = if ($cancelled) { 'CANCELLED' } else { 'UNKNOWN' }
        error_code = $errorCode
        completed_count = $script:CompletedCount
        current_sequence = $script:CurrentSequence
        current_phase = $script:CurrentPhase
        composer_may_contain_unsent_text = $partialComposer
        reconciliation_required_before_resume = ($script:CompletedCount -gt 0 -or $script:CurrentSequence -ne $null)
    })
    $exitCode = if ($cancelled) { 2 } else { 1 }
}
finally {
    if ($script:ClipboardCaptured -and ('System.Windows.Forms.Clipboard' -as [type])) {
        try {
            Restore-P1012Clipboard
        }
        catch {
            Write-P1012Event -Record ([ordered]@{
                test_id = 'P1-012'
                event = 'p1_012_wecom_ui_clipboard_restore_failed'
                outcome = 'UNKNOWN'
                error_code = 'P1_012_UI_CLIPBOARD_RESTORE_FAILED'
                completed_count = $script:CompletedCount
                current_sequence = $script:CurrentSequence
                current_phase = $script:CurrentPhase
                reconciliation_required_before_resume = ($script:CompletedCount -gt 0)
            })
            $exitCode = 1
        }
    }
    if ($script:CursorCaptured -and $null -ne $script:OriginalCursor -and ('P1012WeComBurstNative' -as [type])) {
        [void][P1012WeComBurstNative]::SetCursorPos($script:OriginalCursor.X, $script:OriginalCursor.Y)
    }
}

exit $exitCode
