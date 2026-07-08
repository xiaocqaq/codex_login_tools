namespace CodexLoginTools.Win;

public enum AppDialogKind
{
    Info,
    Warning,
    Error
}

public sealed class AppDialog : Form
{
    private static readonly Color Background = Color.FromArgb(242, 247, 248);
    private static readonly Color Card = Color.White;
    private static readonly Color Primary = Color.FromArgb(18, 111, 126);
    private static readonly Color PrimaryHover = Color.FromArgb(13, 94, 108);
    private static readonly Color Muted = Color.FromArgb(93, 111, 121);
    private static readonly Color Line = Color.FromArgb(218, 229, 233);
    private static readonly Color TextColor = Color.FromArgb(18, 27, 34);
    private static readonly Color Danger = Color.FromArgb(184, 65, 51);
    private static readonly Size DialogSize = new(420, 220);
    private const int ButtonTop = 174;
    private const int ButtonHeight = 36;

    private readonly string _message;
    private readonly AppDialogKind _kind;

    private AppDialog(string title, string message, AppDialogKind kind, IReadOnlyList<DialogAction> actions)
    {
        _message = message;
        _kind = kind;
        AutoScaleMode = AutoScaleMode.None;
        ClientSize = DialogSize;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        Text = title;
        BackColor = Background;
        Font = new Font("Microsoft YaHei UI", 10F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        BuildUi(actions);
    }

    public static void ShowInfo(IWin32Window? owner, string title, string message) =>
        Show(owner, title, message, AppDialogKind.Info);

    public static void ShowWarning(IWin32Window? owner, string title, string message) =>
        Show(owner, title, message, AppDialogKind.Warning);

    public static void ShowError(IWin32Window? owner, string title, string message) =>
        Show(owner, title, FriendlyMessage(message), AppDialogKind.Error);

    public static DialogResult Confirm(IWin32Window? owner, string title, string message, string confirmText = "确定")
    {
        using var dialog = new AppDialog(
            title,
            message,
            AppDialogKind.Warning,
            [
                new DialogAction("取消", DialogResult.Cancel, Color.White, Primary, Line, false),
                new DialogAction(confirmText, DialogResult.Yes, Primary, Color.White, Primary, true)
            ]);
        return dialog.ShowDialog(owner);
    }

    private static void Show(IWin32Window? owner, string title, string message, AppDialogKind kind)
    {
        using var dialog = new AppDialog(
            title,
            message,
            kind,
            [new DialogAction("确定", DialogResult.OK, Primary, Color.White, Primary, true)]);
        dialog.ShowDialog(owner);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var cardBrush = new SolidBrush(Card);
        using var linePen = new Pen(Line);
        using var card = RoundedRect(new Rectangle(24, 28, 372, 128), 14);
        e.Graphics.FillPath(cardBrush, card);
        e.Graphics.DrawPath(linePen, card);
    }

    private void BuildUi(IReadOnlyList<DialogAction> actions)
    {
        Controls.Add(new DialogIcon
        {
            Kind = _kind,
            Location = new Point(46, 70),
            Size = new Size(44, 44),
            BackColor = Card
        });

        Controls.Add(new Label
        {
            AutoSize = false,
            Location = new Point(106, 52),
            Size = new Size(260, 80),
            Text = _message,
            ForeColor = TextColor,
            BackColor = Card,
            TextAlign = ContentAlignment.MiddleLeft
        });

        var right = 396;
        foreach (var action in actions.Reverse())
        {
            right -= 92;
            var button = BuildButton(action, new Point(right, ButtonTop));
            Controls.Add(button);
            right -= 12;
        }
    }

    private Button BuildButton(DialogAction action, Point location)
    {
        var button = new Button
        {
            Text = action.Text,
            DialogResult = action.Result,
            Location = location,
            Size = new Size(92, ButtonHeight),
            BackColor = action.Background,
            ForeColor = action.Foreground,
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand
        };
        button.FlatAppearance.BorderColor = action.Border;
        button.FlatAppearance.MouseOverBackColor = action.Primary ? PrimaryHover : Color.FromArgb(232, 241, 244);
        return button;
    }

    private static string FriendlyMessage(string message)
    {
        if (message.Contains("token disabled", StringComparison.OrdinalIgnoreCase))
        {
            return "当前令牌已被禁用，请联系管理员启用后再启动代理。";
        }

        if (message.Contains("\"error\"", StringComparison.OrdinalIgnoreCase))
        {
            return "服务端返回异常，请检查令牌状态后重试。";
        }

        return message;
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

    private sealed record DialogAction(
        string Text,
        DialogResult Result,
        Color Background,
        Color Foreground,
        Color Border,
        bool Primary);

    private sealed class DialogIcon : Control
    {
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public AppDialogKind Kind { get; init; }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            var color = Kind == AppDialogKind.Error ? Danger : Primary;
            using var fill = new SolidBrush(color);
            using var pen = new Pen(Color.White, 4)
            {
                StartCap = System.Drawing.Drawing2D.LineCap.Round,
                EndCap = System.Drawing.Drawing2D.LineCap.Round
            };
            e.Graphics.FillEllipse(fill, 0, 0, Width - 1, Height - 1);
            if (Kind == AppDialogKind.Info)
            {
                e.Graphics.DrawLine(pen, Width / 2, 13, Width / 2, Height - 12);
                e.Graphics.DrawEllipse(pen, Width / 2 - 1, 8, 2, 2);
                return;
            }

            e.Graphics.DrawLine(pen, 14, 14, Width - 14, Height - 14);
            e.Graphics.DrawLine(pen, Width - 14, 14, 14, Height - 14);
        }
    }
}

public sealed class ProgressDialog : Form
{
    private static readonly Color Background = Color.FromArgb(242, 247, 248);
    private static readonly Color Card = Color.White;
    private static readonly Color TextColor = Color.FromArgb(18, 27, 34);
    private static readonly Color Muted = Color.FromArgb(93, 111, 121);
    private static readonly Color Line = Color.FromArgb(218, 229, 233);

    private readonly Label _message = new();
    private readonly ProgressBar _progress = new();

    public ProgressDialog(string title, string message)
    {
        AutoScaleMode = AutoScaleMode.None;
        ClientSize = new Size(420, 150);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        StartPosition = FormStartPosition.CenterParent;
        Text = title;
        BackColor = Background;
        Font = new Font("Microsoft YaHei UI", 10F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BuildUi(message);
    }

    public void UpdateProgress(CodexInstallProgress progress)
    {
        if (!string.IsNullOrWhiteSpace(progress.Message))
        {
            _message.Text = progress.Message;
        }

        if (progress.Percent.HasValue)
        {
            _progress.Style = ProgressBarStyle.Continuous;
            _progress.Value = Math.Clamp(progress.Percent.Value, 0, 100);
        }
        else
        {
            _progress.Style = ProgressBarStyle.Marquee;
        }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using var cardBrush = new SolidBrush(Card);
        using var linePen = new Pen(Line);
        using var card = RoundedRect(new Rectangle(24, 24, 372, 92), 14);
        e.Graphics.FillPath(cardBrush, card);
        e.Graphics.DrawPath(linePen, card);
    }

    private void BuildUi(string message)
    {
        _message.Location = new Point(48, 48);
        _message.Size = new Size(326, 28);
        _message.Text = message;
        _message.ForeColor = Muted;
        _message.BackColor = Card;
        Controls.Add(_message);

        _progress.Location = new Point(48, 88);
        _progress.Size = new Size(326, 12);
        _progress.Style = ProgressBarStyle.Marquee;
        Controls.Add(_progress);
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
