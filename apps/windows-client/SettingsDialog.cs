namespace CodexLoginTools.Win;

public sealed class SettingsDialog : Form
{
    private static readonly Color Background = Color.FromArgb(242, 247, 248);
    private static readonly Color Card = Color.White;
    private static readonly Color Primary = Color.FromArgb(18, 111, 126);
    private static readonly Color PrimaryHover = Color.FromArgb(13, 94, 108);
    private static readonly Color TextColor = Color.FromArgb(18, 27, 34);
    private static readonly Color Muted = Color.FromArgb(93, 111, 121);
    private static readonly Color Line = Color.FromArgb(218, 229, 233);

    private readonly TextBox _token = new();
    private readonly Label _installStatus = new();
    private readonly ProgressBar _installProgress = new();
    private readonly Button _installButton = new();
    private readonly AppSettings _settings;

    public string ClientToken => _token.Text.Trim();

    public SettingsDialog(AppSettings settings)
    {
        _settings = new AppSettings
        {
            ServerUrl = "https://admin.xlingo.fun",
            ClientToken = settings.ClientToken,
            GatewayPort = 17861
        };

        AutoScaleMode = AutoScaleMode.None;
        ClientSize = new Size(480, 360);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        Text = "设置";
        BackColor = Background;
        Font = new Font("Microsoft YaHei UI", 10F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        BuildUi();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var cardBrush = new SolidBrush(Card);
        using var linePen = new Pen(Line);
        using var card = RoundedRect(new Rectangle(24, 70, 432, 206), 14);
        e.Graphics.FillPath(cardBrush, card);
        e.Graphics.DrawPath(linePen, card);
    }

    private void BuildUi()
    {
        Controls.Add(new Label
        {
            AutoSize = false,
            Location = new Point(28, 22),
            Size = new Size(240, 36),
            Text = "设置",
            Font = new Font(Font.FontFamily, 18F, FontStyle.Bold),
            ForeColor = TextColor,
            BackColor = Background
        });

        Controls.Add(new Label
        {
            AutoSize = false,
            Location = new Point(48, 96),
            Size = new Size(160, 24),
            Text = "客户端 Token",
            Font = new Font(Font.FontFamily, 10F, FontStyle.Bold),
            ForeColor = TextColor,
            BackColor = Card
        });

        _token.Location = new Point(48, 128);
        _token.Size = new Size(384, 32);
        _token.Font = new Font(Font.FontFamily, 11F);
        _token.UseSystemPasswordChar = true;
        _token.BorderStyle = BorderStyle.FixedSingle;
        _token.Text = _settings.ClientToken;
        Controls.Add(_token);

        _installStatus.Location = new Point(48, 190);
        _installStatus.Size = new Size(250, 28);
        _installStatus.ForeColor = Muted;
        _installStatus.BackColor = Card;
        _installStatus.Text = "Codex Desktop 安装状态";
        Controls.Add(_installStatus);

        _installButton.Location = new Point(312, 184);
        _installButton.Size = new Size(120, 34);
        _installButton.Text = "安装桌面版";
        _installButton.FlatStyle = FlatStyle.Flat;
        _installButton.FlatAppearance.BorderColor = Line;
        _installButton.BackColor = Color.White;
        _installButton.ForeColor = Primary;
        _installButton.Cursor = Cursors.Hand;
        _installButton.Click += async (_, _) => await InstallCodexAsync();
        Controls.Add(_installButton);

        _installProgress.Location = new Point(48, 238);
        _installProgress.Size = new Size(384, 12);
        _installProgress.Visible = false;
        Controls.Add(_installProgress);

        var cancel = BuildFooterButton("取消", new Point(224, 302), Color.White, Primary, Line);
        cancel.DialogResult = DialogResult.Cancel;
        Controls.Add(cancel);

        var save = BuildFooterButton("保存", new Point(344, 302), Primary, Color.White, Primary);
        save.Click += (_, _) =>
        {
            DialogResult = DialogResult.OK;
            Close();
        };
        Controls.Add(save);

        AcceptButton = save;
        CancelButton = cancel;
    }

    private async Task InstallCodexAsync()
    {
        try
        {
            _settings.ClientToken = ClientToken;
            if (string.IsNullOrWhiteSpace(_settings.ClientToken))
            {
                MessageBox.Show(this, "请先填写客户端 Token。", "缺少 Token", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _installButton.Enabled = false;
            _installButton.Text = "安装中";
            _installProgress.Value = 0;
            _installProgress.Style = ProgressBarStyle.Continuous;
            _installProgress.Visible = true;
            _installStatus.Text = "正在准备安装。";

            var progress = new Progress<CodexInstallProgress>(UpdateInstallProgress);
            var result = await CodexInstaller.InstallCodexDesktopAsync(_settings, progress);
            _installStatus.Text = CodexInstaller.IsCodexInstalled()
                ? "已检测到 Codex Desktop。"
                : "未检测到 Codex Desktop。";
            MessageBox.Show(
                this,
                BuildInstallMessage(result),
                result.Success ? "安装完成" : "安装失败",
                MessageBoxButtons.OK,
                result.Success ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        }
        catch (Exception error)
        {
            _installStatus.Text = "安装失败，按钮已恢复。";
            MessageBox.Show(this, error.Message, "安装失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _installButton.Text = "安装桌面版";
            _installButton.Enabled = true;
            _installProgress.Visible = false;
            _installProgress.Style = ProgressBarStyle.Continuous;
            _installProgress.Value = 0;
        }
    }

    private void UpdateInstallProgress(CodexInstallProgress progress)
    {
        if (!string.IsNullOrWhiteSpace(progress.Message))
        {
            _installStatus.Text = progress.Message;
        }

        if (progress.Percent.HasValue)
        {
            _installProgress.Style = ProgressBarStyle.Continuous;
            _installProgress.Value = Math.Clamp(progress.Percent.Value, 0, 100);
        }
        else
        {
            _installProgress.Style = ProgressBarStyle.Marquee;
        }
    }

    private Button BuildFooterButton(string text, Point location, Color background, Color foreground, Color border)
    {
        var button = new Button
        {
            Text = text,
            Location = location,
            Size = new Size(88, 36),
            BackColor = background,
            ForeColor = foreground,
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand
        };
        button.FlatAppearance.BorderColor = border;
        button.FlatAppearance.MouseOverBackColor = background == Primary ? PrimaryHover : Color.FromArgb(232, 241, 244);
        return button;
    }

    private static string BuildInstallMessage(CodexInstallResult result)
    {
        if (string.IsNullOrWhiteSpace(result.Output))
        {
            return result.Message;
        }

        var output = result.Output.Trim();
        if (output.Length > 1200)
        {
            output = output[^1200..];
        }

        return result.Message + "\n\n安装日志：\n" + output;
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
}
