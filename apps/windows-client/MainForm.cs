using System.Reflection;

namespace CodexLoginTools.Win;

public sealed class MainForm : Form
{
    private static readonly Color Background = Color.FromArgb(242, 247, 248);
    private static readonly Color Card = Color.FromArgb(255, 255, 255);
    private static readonly Color Primary = Color.FromArgb(18, 111, 126);
    private static readonly Color PrimaryHover = Color.FromArgb(13, 94, 108);
    private static readonly Color Danger = Color.FromArgb(184, 65, 51);
    private static readonly Color TextColor = Color.FromArgb(18, 27, 34);
    private static readonly Color Muted = Color.FromArgb(93, 111, 121);
    private static readonly Color Line = Color.FromArgb(218, 229, 233);
    private static readonly Color Success = Color.FromArgb(29, 126, 74);

    private readonly Label _versionLabel = new();
    private readonly Label _statusTitle = new();
    private readonly Label _statusDetail = new();
    private readonly Label _codexStatus = new();
    private readonly ActionButton _toggle = new();
    private readonly ActionButton _settingsButton = new();
    private readonly NotifyIcon _trayIcon = new();
    private readonly GatewayServer _gateway;
    private AppSettings _settings;
    private bool _allowExit;
    private bool _checkingClientUpdate;

    public MainForm()
    {
        ClientLog.Write("main form ctor start");
        _settings = SettingsStore.Load();
        _gateway = new GatewayServer(_settings);

        AutoScaleMode = AutoScaleMode.None;
        ClientSize = new Size(560, 410);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = true;
        StartPosition = FormStartPosition.CenterScreen;
        Text = "Codex 代理";
        BackColor = Background;
        Font = new Font("Microsoft YaHei UI", 10F);
        ShowInTaskbar = true;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        CodexConfigWriter.Restore();
        CodexAuthWriter.Restore();
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        BuildTray();
        BuildUi();
        UpdateGatewayStatus();
        _codexStatus.Text = "正在检测 Codex 桌面版。";

        Shown += async (_, _) =>
        {
            WindowState = FormWindowState.Normal;
            TopMost = true;
            Activate();
            await Task.Delay(500);
            if (!IsDisposed)
            {
                TopMost = false;
            }

            _ = RefreshCodexStatusAsync();
            _ = CheckForClientUpdateAsync();
        };
        FormClosing += OnMainFormClosing;
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var cardBrush = new SolidBrush(Card);
        using var linePen = new Pen(Line);
        var cardRect = new Rectangle(32, 152, 496, 170);
        using var path = RoundedRect(cardRect, 14);
        e.Graphics.FillPath(cardBrush, path);
        e.Graphics.DrawPath(linePen, path);
    }

    private void BuildUi()
    {
        SuspendLayout();

        Controls.Add(new LogoMark
        {
            Location = new Point(38, 58),
            Size = new Size(42, 42)
        });

        Controls.Add(new Label
        {
            AutoSize = false,
            Location = new Point(96, 52),
            Size = new Size(300, 54),
            Text = "Codex 代理",
            Font = new Font(Font.FontFamily, 23F, FontStyle.Bold),
            ForeColor = TextColor,
            BackColor = Background
        });

        Controls.Add(new Label
        {
            AutoSize = false,
            Location = new Point(98, 106),
            Size = new Size(410, 28),
            Text = "一键为本机 Codex 桌面版接入代理。",
            ForeColor = Muted,
            BackColor = Background
        });

        _versionLabel.Location = new Point(386, 18);
        _versionLabel.Size = new Size(84, 28);
        _versionLabel.Text = $"v{GetCurrentVersion()}";
        _versionLabel.TextAlign = ContentAlignment.MiddleRight;
        _versionLabel.ForeColor = Muted;
        _versionLabel.BackColor = Background;
        Controls.Add(_versionLabel);

        _settingsButton.Text = "设置";
        _settingsButton.Location = new Point(480, 16);
        _settingsButton.Size = new Size(56, 30);
        _settingsButton.Font = new Font(Font.FontFamily, 9F, FontStyle.Bold);
        _settingsButton.NormalColor = Color.White;
        _settingsButton.HoverColor = Color.FromArgb(232, 241, 244);
        _settingsButton.BorderColor = Line;
        _settingsButton.BackColor = Background;
        _settingsButton.ForeColor = Primary;
        _settingsButton.Click += (_, _) => ShowSettingsDialog();
        Controls.Add(_settingsButton);

        _toggle.Location = new Point(60, 190);
        _toggle.Size = new Size(440, 54);
        _toggle.Font = new Font(Font.FontFamily, 13F, FontStyle.Bold);
        _toggle.NormalColor = Primary;
        _toggle.HoverColor = PrimaryHover;
        _toggle.BackColor = Card;
        _toggle.ForeColor = Color.White;
        _toggle.Click += async (_, _) => await ToggleGatewayAsync();
        Controls.Add(_toggle);

        _statusTitle.Location = new Point(60, 274);
        _statusTitle.Size = new Size(96, 26);
        _statusTitle.Font = new Font(Font.FontFamily, 10F, FontStyle.Bold);
        _statusTitle.ForeColor = Muted;
        _statusTitle.BackColor = Card;
        Controls.Add(_statusTitle);

        _statusDetail.Location = new Point(156, 275);
        _statusDetail.Size = new Size(344, 26);
        _statusDetail.ForeColor = Muted;
        _statusDetail.BackColor = Card;
        Controls.Add(_statusDetail);

        _codexStatus.Location = new Point(38, 350);
        _codexStatus.Size = new Size(490, 28);
        _codexStatus.ForeColor = Muted;
        _codexStatus.BackColor = Background;
        Controls.Add(_codexStatus);

        ResumeLayout(false);
        ClientLog.Write("main form ui built");
    }

    private void BuildTray()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开", null, (_, _) => RestoreFromTray());
        menu.Items.Add("退出", null, (_, _) => ExitApplication());
        _trayIcon.Icon = Icon ?? SystemIcons.Application;
        _trayIcon.Text = "Codex 代理";
        _trayIcon.Visible = true;
        _trayIcon.ContextMenuStrip = menu;
        _trayIcon.DoubleClick += (_, _) => RestoreFromTray();
    }

    private async Task ToggleGatewayAsync()
    {
        try
        {
            _toggle.Enabled = false;
            if (_gateway.IsRunning)
            {
                StopGatewayAndRestoreConfig();
            }
            else
            {
                ReadSettings();
                if (string.IsNullOrWhiteSpace(_settings.ClientToken))
                {
                    AppDialog.ShowWarning(this, "缺少 Token", "请先在设置中填写客户端 Token。");
                    ShowSettingsDialog();
                    return;
                }

                SettingsStore.Save(_settings);
                if (await CheckForClientUpdateAsync())
                {
                    return;
                }

                if (!await IsCodexDesktopReadyAsync())
                {
                    if (!await PromptInstallCodexDesktopAsync())
                    {
                        return;
                    }
                }

                await _gateway.StartAsync(_settings);
                try
                {
                    CodexConfigWriter.Apply(_settings, _gateway.GetCodexModel());
                    CodexAuthWriter.Apply();
                }
                catch
                {
                    StopGatewayAndRestoreConfig();
                    throw;
                }
            }

            UpdateGatewayStatus();
        }
        catch (Exception error)
        {
            AppDialog.ShowError(this, "操作失败", error.Message);
        }
        finally
        {
            _toggle.Enabled = true;
        }
    }

    private bool ShowSettingsDialog()
    {
        ReadSettings();
        using var dialog = new SettingsDialog(_settings);
        var result = dialog.ShowDialog(this);
        if (result != DialogResult.OK)
        {
            _settings = SettingsStore.Load();
            return false;
        }

        _settings.ClientToken = dialog.ClientToken;
        SettingsStore.Save(_settings);
        UpdateGatewayStatus();
        _ = RefreshCodexStatusAsync();
        return true;
    }

    private void ReadSettings()
    {
        _settings.ServerUrl = "https://admin.xlingo.fun";
        _settings.GatewayPort = 17861;
    }

    private async Task<bool> IsCodexDesktopReadyAsync()
    {
        _codexStatus.Text = "正在检测 Codex 桌面版。";
        var installed = await CodexInstaller.IsCodexInstalledAsync();
        if (!IsDisposed)
        {
            _codexStatus.Text = installed ? "已检测到 Codex 桌面版。" : "未检测到 Codex 桌面版。";
        }

        return installed;
    }

    private async Task<bool> PromptInstallCodexDesktopAsync()
    {
        var choice = AppDialog.Confirm(
            this,
            "未检测到 Codex 桌面版",
            "启动代理前需要安装 Codex 桌面版。是否现在一键安装？",
            "一键安装");
        if (choice != DialogResult.Yes)
        {
            _codexStatus.Text = "未检测到 Codex 桌面版。";
            return false;
        }

        if (string.IsNullOrWhiteSpace(_settings.ClientToken))
        {
            AppDialog.ShowWarning(this, "缺少 Token", "请先在设置中填写客户端 Token。");
            ShowSettingsDialog();
            return false;
        }

        using var progressDialog = new ProgressDialog("安装 Codex 桌面版", "正在准备安装。");
        var progress = new Progress<CodexInstallProgress>(progressDialog.UpdateProgress);
        progressDialog.Show(this);
        CodexInstallResult result;
        try
        {
            result = await CodexInstaller.InstallCodexDesktopAsync(_settings, progress);
        }
        finally
        {
            progressDialog.Close();
        }

        var installed = await CodexInstaller.IsCodexInstalledAsync();
        if (!IsDisposed)
        {
            _codexStatus.Text = installed ? "已检测到 Codex 桌面版。" : "未检测到 Codex 桌面版。";
        }

        if (!result.Success)
        {
            AppDialog.ShowWarning(this, "安装失败", BuildInstallMessage(result));
            return false;
        }

        AppDialog.ShowInfo(this, "安装完成", "Codex 桌面版已安装完成，可以继续启动代理。");
        return installed;
    }

    private async Task<bool> CheckForClientUpdateAsync()
    {
        if (_checkingClientUpdate)
        {
            return false;
        }

        try
        {
            _checkingClientUpdate = true;
            ReadSettings();
            var update = await ClientUpdater.CheckAsync(_settings);
            if (!update.Available || IsDisposed)
            {
                return false;
            }

            var choice = AppDialog.Confirm(
                this,
                "发现新版本",
                $"发现新版本 {update.RemoteVersion}，当前版本 {update.CurrentVersion}。\n是否立即更新？",
                "立即更新");
            if (choice != DialogResult.Yes)
            {
                return false;
            }

            _codexStatus.Text = "正在下载客户端更新。";
            using var progressDialog = new ProgressDialog("正在更新工具", "正在准备下载更新。");
            var progress = new Progress<CodexInstallProgress>(progressDialog.UpdateProgress);
            progressDialog.Show(this);
            try
            {
                await ClientUpdater.DownloadAndApplyAsync(_settings, progress);
            }
            finally
            {
                progressDialog.Close();
            }
            StopGatewayAndRestoreConfig();
            _allowExit = true;
            Application.Exit();
            return true;
        }
        catch (Exception error)
        {
            ClientLog.Write("client update failed: " + error);
            return false;
        }
        finally
        {
            _checkingClientUpdate = false;
        }
    }

    private void StopGatewayAndRestoreConfig()
    {
        if (_gateway.IsRunning)
        {
            _gateway.Stop();
        }

        CodexConfigWriter.Restore();
        CodexAuthWriter.Restore();
    }

    private void UpdateGatewayStatus()
    {
        var running = _gateway.IsRunning;
        _toggle.Text = running ? "关闭代理" : "启动代理";
        _toggle.NormalColor = running ? Danger : Primary;
        _toggle.HoverColor = running ? Color.FromArgb(157, 50, 40) : PrimaryHover;
        _toggle.Invalidate();

        _statusTitle.Text = running ? "已启动" : "未启动";
        _statusTitle.ForeColor = running ? Success : Muted;
        _statusDetail.Text = running
            ? "Codex 请求正在通过本机代理转发。"
            : string.IsNullOrWhiteSpace(_settings.ClientToken)
                ? "请先打开设置填写 Token。"
                : "点击启动后接入代理。";
    }

    private async Task RefreshCodexStatusAsync()
    {
        bool installed;
        try
        {
            installed = await CodexInstaller.IsCodexInstalledAsync();
        }
        catch
        {
            installed = false;
        }

        if (!IsDisposed)
        {
            _codexStatus.Text = installed ? "已检测到 Codex 桌面版。" : "未检测到 Codex 桌面版。";
        }
    }

    private static string BuildInstallMessage(CodexInstallResult result)
    {
        if (string.IsNullOrWhiteSpace(result.Output))
        {
            return result.Message;
        }

        var output = result.Output.Trim();
        if (output.Length > 800)
        {
            output = output[^800..];
        }

        return result.Message + "\n\n安装日志：\n" + output;
    }

    private void OnMainFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (!_allowExit && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            HideToTray();
            return;
        }

        StopGatewayAndRestoreConfig();
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
    }

    private void HideToTray()
    {
        Hide();
        ShowInTaskbar = false;
        _trayIcon.Visible = true;
    }

    private void RestoreFromTray()
    {
        ShowInTaskbar = true;
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private void ExitApplication()
    {
        _allowExit = true;
        Close();
    }

    private static string GetCurrentVersion()
    {
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        return (version ?? "0.0.0").Split('+')[0];
    }

    private static System.Drawing.Drawing2D.GraphicsPath RoundedRect(Rectangle rect, int radius)
    {
        var path = new System.Drawing.Drawing2D.GraphicsPath();
        var diameter = radius * 2;
        path.AddArc(rect.X, rect.Y, diameter, diameter, 180, 90);
        path.AddArc(rect.Right - diameter, rect.Y, diameter, diameter, 270, 90);
        path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(rect.X, rect.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    private sealed class LogoMark : Control
    {
        public LogoMark()
        {
            DoubleBuffered = true;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var background = new SolidBrush(Primary);
            using var accent = new SolidBrush(Color.FromArgb(55, 189, 166));
            using var pen = new Pen(Color.White, Math.Max(4, Width / 10))
            {
                StartCap = System.Drawing.Drawing2D.LineCap.Round,
                EndCap = System.Drawing.Drawing2D.LineCap.Round
            };

            e.Graphics.FillEllipse(background, 0, 0, Width - 1, Height - 1);
            e.Graphics.FillEllipse(accent, Width - 14, 5, 9, 9);
            e.Graphics.DrawArc(pen, 11, 11, Width - 22, Height - 22, 42, 272);
            e.Graphics.DrawLine(pen, Width / 2, 11, Width / 2, Height - 11);
            e.Graphics.DrawLine(pen, Width / 2, Height - 11, Width - 11, Height - 11);
        }
    }

    private sealed class ActionButton : Control
    {
        private bool _hovered;

        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public Color NormalColor { get; set; } = Primary;

        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public Color HoverColor { get; set; } = PrimaryHover;

        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public Color BorderColor { get; set; } = Color.Transparent;

        public ActionButton()
        {
            SetStyle(
                ControlStyles.AllPaintingInWmPaint |
                ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw |
                ControlStyles.UserPaint |
                ControlStyles.StandardClick,
                true);
            TabStop = false;
            BackColor = SystemColors.Control;
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e)
        {
            _hovered = true;
            Invalidate();
            base.OnMouseEnter(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            _hovered = false;
            Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnEnabledChanged(EventArgs e)
        {
            Cursor = Enabled ? Cursors.Hand : Cursors.Default;
            Invalidate();
            base.OnEnabledChanged(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var surfaceColor = BackColor == Color.Transparent
                ? Parent?.BackColor ?? SystemColors.Control
                : BackColor;
            using var surface = new SolidBrush(surfaceColor);
            e.Graphics.FillRectangle(surface, ClientRectangle);

            var rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using var path = RoundedRect(rect, 10);
            using var fill = new SolidBrush(Enabled ? (_hovered ? HoverColor : NormalColor) : Color.FromArgb(206, 216, 220));
            using var border = new Pen(BorderColor);
            e.Graphics.FillPath(fill, path);
            if (BorderColor != Color.Transparent)
            {
                e.Graphics.DrawPath(border, path);
            }

            TextRenderer.DrawText(
                e.Graphics,
                Text,
                Font,
                rect,
                Enabled ? ForeColor : Color.FromArgb(120, 132, 140),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }
    }
}
