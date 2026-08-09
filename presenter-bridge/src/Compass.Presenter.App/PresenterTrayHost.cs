using System.Drawing;
using System.Runtime.Versioning;

namespace Compass.Presenter.App;

[SupportedOSPlatform("windows10.0.19041")]
internal sealed class PresenterTrayHost : IAsyncDisposable
{
    private readonly Func<
        string,
        Action<ManualRecoveryStage>,
        CancellationToken,
        Task> recover;
    private readonly Action requestShutdown;
    private readonly CancellationTokenSource lifetime = new();
    private readonly TaskCompletionSource ready = new(
        TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource stopped = new(
        TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly Thread thread;
    private ApplicationContext? applicationContext;
    private Form? activeDialog;
    private Task recoveryTask = Task.CompletedTask;
    private NotifyIcon? notifyIcon;
    private ToolStripMenuItem? recoveryItem;
    private ToolStripMenuItem? statusItem;
    private int presenterSessionState;
    private int recoveryRunning;
    private int disposed;
    private SynchronizationContext? uiContext;

    private PresenterTrayHost(
        Func<
            string,
            Action<ManualRecoveryStage>,
            CancellationToken,
            Task> recover,
        Action requestShutdown)
    {
        this.recover = recover;
        this.requestShutdown = requestShutdown;
        thread = new Thread(Run)
        {
            IsBackground = true,
            Name = "COMPASS Presenter Bridge UI",
        };
        thread.SetApartmentState(ApartmentState.STA);
    }

    public static async Task<PresenterTrayHost> StartAsync(
        Func<
            string,
            Action<ManualRecoveryStage>,
            CancellationToken,
            Task> recover,
        Action requestShutdown)
    {
        var host = new PresenterTrayHost(recover, requestShutdown);
        host.thread.Start();
        try
        {
            await host.ready.Task.ConfigureAwait(false);
            return host;
        }
        catch
        {
            await host.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private void Run()
    {
        try
        {
            using var menu = new ContextMenuStrip();
            using var recoveryItem = new ToolStripMenuItem("復旧コードを入力");
            using var localStatusItem = new ToolStripMenuItem("状態: 待機中")
            {
                Enabled = false,
            };
            using var exitItem = new ToolStripMenuItem("終了");
            menu.Items.Add(localStatusItem);
            menu.Items.Add(recoveryItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);
            using var icon = new NotifyIcon
            {
                ContextMenuStrip = menu,
                Icon = SystemIcons.Application,
                Text = "COMPASS Presenter Bridge",
                Visible = true,
            };
            using var context = new ApplicationContext();
            applicationContext = context;
            notifyIcon = icon;
            this.recoveryItem = recoveryItem;
            statusItem = localStatusItem;
            recoveryItem.Click += (_, _) => StartRecovery(icon);
            exitItem.Click += (_, _) =>
            {
                exitItem.Enabled = false;
                recoveryItem.Enabled = false;
                SetStatus("状態: 終了しています…");
                requestShutdown();
            };
            icon.DoubleClick += (_, _) => StartRecovery(icon);
            uiContext = SynchronizationContext.Current ??
                new WindowsFormsSynchronizationContext();
            ready.TrySetResult();
            Application.Run(context);
            icon.Visible = false;
        }
        catch (Exception error)
        {
            if (!ready.TrySetException(
                    new InvalidOperationException(
                        "Presenter tray could not start.",
                        error)))
            {
                requestShutdown();
            }
        }
        finally
        {
            activeDialog = null;
            applicationContext = null;
            notifyIcon = null;
            this.recoveryItem = null;
            statusItem = null;
            uiContext = null;
            stopped.TrySetResult();
        }
    }

    private void StartRecovery(NotifyIcon icon)
    {
        if (lifetime.IsCancellationRequested)
        {
            return;
        }
        if ((PresenterSessionState)Volatile.Read(ref presenterSessionState) ==
            PresenterSessionState.Active)
        {
            SetStatus("状態: PowerPoint同期中");
            return;
        }
        if (Interlocked.Exchange(ref recoveryRunning, 1) != 0)
        {
            SetStatus("状態: 復旧処理中");
            return;
        }
        if (recoveryItem is not null)
        {
            recoveryItem.Enabled = false;
        }
        recoveryTask = BeginRecoveryAsync(icon);
    }

    private async Task BeginRecoveryAsync(NotifyIcon icon)
    {
        await Task.Yield();
        try
        {
            var code = PromptForRecoveryCode();
            if (code is null)
            {
                SetStatus("状態: 待機中");
                return;
            }
            SetStatus("状態: 接続を確認中…");
            await recover(
                code,
                ReportRecoveryStage,
                lifetime.Token).ConfigureAwait(true);
            SetStatus("状態: PowerPoint同期中");
            icon.ShowBalloonTip(
                5_000,
                "COMPASS Presenter Bridge",
                "PowerPoint同期を開始しました。",
                ToolTipIcon.Info);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
            SetStatus("状態: 終了しています…");
        }
        catch (PresenterRemoteException error)
        {
            var text = RecoveryErrorText(error.Code);
            SetStatus(text);
            icon.ShowBalloonTip(
                6_000,
                "COMPASS Presenter Bridge",
                text.Replace("状態: ", string.Empty, StringComparison.Ordinal),
                ToolTipIcon.Warning);
        }
        catch
        {
            SetStatus("状態: 接続できませんでした");
            icon.ShowBalloonTip(
                6_000,
                "COMPASS Presenter Bridge",
                "接続を開始できませんでした。PowerPointとネットワークを確認してください。",
                ToolTipIcon.Warning);
        }
        finally
        {
            Volatile.Write(ref recoveryRunning, 0);
            if (recoveryItem is not null &&
                !lifetime.IsCancellationRequested &&
                (PresenterSessionState)Volatile.Read(
                    ref presenterSessionState) != PresenterSessionState.Active)
            {
                recoveryItem.Enabled = true;
            }
        }
    }

    public void ReportSessionState(PresenterSessionState state)
    {
        Interlocked.Exchange(ref presenterSessionState, (int)state);
        Volatile.Read(ref uiContext)?.Post(
            _ =>
            {
                if (lifetime.IsCancellationRequested)
                {
                    return;
                }
                if (recoveryItem is not null)
                {
                    recoveryItem.Enabled =
                        state != PresenterSessionState.Active &&
                        Volatile.Read(ref recoveryRunning) == 0;
                }
                switch (state)
                {
                    case PresenterSessionState.Active:
                        SetStatus("状態: PowerPoint同期中");
                        break;
                    case PresenterSessionState.Faulted:
                        SetStatus("状態: 同期が停止しました");
                        notifyIcon?.ShowBalloonTip(
                            6_000,
                            "COMPASS Presenter Bridge",
                            "PowerPoint同期が停止しました。PowerPointを確認し、必要なら復旧コードで再接続してください。",
                            ToolTipIcon.Warning);
                        break;
                    default:
                        SetStatus("状態: 待機中");
                        break;
                }
            },
            null);
    }

    private void ReportRecoveryStage(ManualRecoveryStage stage)
    {
        var text = stage switch
        {
            ManualRecoveryStage.Inspecting => "状態: PowerPointを確認中…",
            ManualRecoveryStage.AwaitingTeacherConfirmation =>
                "状態: 管理画面で確認してください",
            ManualRecoveryStage.Active => "状態: PowerPoint同期中",
            _ => "状態: 復旧処理中",
        };
        Volatile.Read(ref uiContext)?.Post(_ => SetStatus(text), null);
    }

    private void SetStatus(string text)
    {
        if (statusItem is not null)
        {
            statusItem.Text = text;
        }
    }

    private string? PromptForRecoveryCode()
    {
        using var form = new Form
        {
            AcceptButton = null,
            AutoScaleMode = AutoScaleMode.Dpi,
            ClientSize = new Size(390, 170),
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = true,
            StartPosition = FormStartPosition.Manual,
            Text = "COMPASS Presenter Bridge",
            TopMost = true,
        };
        var workingArea = Screen.FromPoint(Cursor.Position).WorkingArea;
        form.Location = new Point(
            workingArea.Left + Math.Max(0, (workingArea.Width - form.Width) / 2),
            workingArea.Top + Math.Max(0, (workingArea.Height - form.Height) / 2));
        using var label = new Label
        {
            AutoSize = true,
            Location = new Point(20, 18),
            Text = "教員画面に表示された8文字の復旧コードを入力してください。",
        };
        using var input = new TextBox
        {
            CharacterCasing = CharacterCasing.Upper,
            Location = new Point(20, 52),
            MaxLength = 8,
            Width = 350,
        };
        using var connect = new Button
        {
            DialogResult = DialogResult.OK,
            Enabled = false,
            Location = new Point(208, 108),
            Text = "接続",
            Width = 76,
        };
        using var cancel = new Button
        {
            DialogResult = DialogResult.Cancel,
            Location = new Point(294, 108),
            Text = "キャンセル",
            Width = 76,
        };
        input.TextChanged += (_, _) =>
            connect.Enabled = IsManualCode(input.Text.Trim());
        form.Controls.AddRange([label, input, connect, cancel]);
        form.AcceptButton = connect;
        form.CancelButton = cancel;
        form.Shown += (_, _) => input.Focus();
        activeDialog = form;
        try
        {
            if (form.ShowDialog() != DialogResult.OK)
            {
                input.Clear();
                return null;
            }
            var code = input.Text.Trim().ToUpperInvariant();
            input.Clear();
            return IsManualCode(code) ? code : null;
        }
        finally
        {
            activeDialog = null;
        }
    }

    private static bool IsManualCode(string code) =>
        code.Length == 8 &&
        code.All(character =>
            character is >= 'A' and <= 'Z' and not ('I' or 'O') ||
            character is >= '2' and <= '9');

    private static string RecoveryErrorText(string code) => code switch
    {
        "connection_expired" or "manual_code_expired" =>
            "状態: 復旧コードの期限が切れました",
        "connection_revoked" => "状態: 接続は停止されています",
        "credential_invalid" or "manual_code_invalid" =>
            "状態: 復旧コードを確認してください",
        "feature_disabled" => "状態: PowerPoint同期は現在利用できません",
        "connector_conflict" => "状態: 別のPowerPointが同期中です",
        "current_slide_order_mismatch" =>
            "状態: 現在のスライド位置を確認してください",
        "custom_or_partial_show_unsupported" =>
            "状態: すべてのスライドへ切り替えてください",
        "hidden_slides_unsupported" =>
            "状態: 非表示スライドを解除してください",
        "multiple_slide_shows" =>
            "状態: スライドショーを1つだけ開いてください",
        "page_count_mismatch" =>
            "状態: PowerPointと資料の枚数が一致しません",
        "powerpoint_not_running" => "状態: PowerPointを開始してください",
        "presenter_view_must_be_disabled" =>
            "状態: 発表者ツールをオフにしてください",
        "rate_limited" => "状態: 少し待ってから再試行してください",
        "slide_id_order_invalid" =>
            "状態: PowerPointを保存して開き直してください",
        "service_unavailable" => "状態: 接続先を確認できません",
        "windowed_slide_show_required" =>
            "状態: ウィンドウ表示へ切り替えてください",
        _ => "状態: 接続できませんでした",
    };

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0)
        {
            return;
        }
        lifetime.Cancel();
        Volatile.Read(ref uiContext)?.Post(
            _ => activeDialog?.Close(),
            null);
        try
        {
            await recoveryTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested)
        {
        }
        Volatile.Read(ref uiContext)?.Post(
            _ => applicationContext?.ExitThread(),
            null);
        await stopped.Task.ConfigureAwait(false);
        if (thread.IsAlive && Thread.CurrentThread != thread)
        {
            thread.Join(TimeSpan.FromSeconds(1));
        }
        lifetime.Dispose();
    }
}
