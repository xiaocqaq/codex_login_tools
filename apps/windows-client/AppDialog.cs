namespace CodexLoginTools.Win;

public enum AppDialogKind
{
    Info,
    Warning,
    Error
}

public sealed class AppDialog : ScaledForm
{
    private static readonly Color Background = Color.FromArgb(242, 247, 248);
    private static readonly Color Card = Color.White;
    private static readonly Color Primary = Color.FromArgb(18, 111, 126);
    private static readonly Color PrimaryHover = Color.FromArgb(13, 94, 108);
    private static readonly Color Muted = Color.FromArgb(93, 111, 121);
    private static readonly Color Line = Color.FromArgb(218, 229, 233);
    private static readonly Color TextColor = Color.FromArgb(18, 27, 34);
    private static readonly Color Danger = Color.FromArgb(184, 65, 51);
    private const int ButtonHeight = 36;

    private readonly string _message;
    private readonly AppDialogKind _kind;
    private readonly IReadOnlyList<DialogAction> _actions;
    private Rectangle _cardRect = new(24, 20, 372, 150);
    private bool _built;

    private AppDialog(string title, string message, AppDialogKind kind, IReadOnlyList<DialogAction> actions)
    {
        _message = message;
        _kind = kind;
        _actions = actions;
        // 这些弹窗手动按 DPI 缩放，关闭自动缩放以免与手动缩放叠加。
        AutoScaleMode = AutoScaleMode.None;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        Text = title;
        BackColor = Background;
        Font = new Font("Microsoft YaHei UI", 10F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        // 句柄已创建，DeviceDpi 此时才准确，据此手动缩放布局。
        if (!_built)
        {
            _built = true;
            BuildUi(_actions);
            RecenterToOwner();
        }
    }

    private void RecenterToOwner()
    {
        if (Owner is { } owner)
        {
            var x = owner.Left + (owner.Width - Width) / 2;
            var y = owner.Top + (owner.Height - Height) / 2;
            Location = new Point(Math.Max(0, x), Math.Max(0, y));
        }
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
        using var card = RoundedRect(_cardRect, ScaleInt(14));
        e.Graphics.FillPath(cardBrush, card);
        e.Graphics.DrawPath(linePen, card);
    }

    private void BuildUi(IReadOnlyList<DialogAction> actions)
    {
        // 全部换算为设备像素：固定尺寸用 ScaleInt 按当前 DPI 缩放，文字用当前 DPI 实测，单一坐标系不叠加。
        var dialogWidth = ScaleInt(420);
        var cardX = ScaleInt(24);
        var cardY = ScaleInt(20);
        var cardW = dialogWidth - cardX * 2;
        var inset = ScaleInt(24);
        var iconSize = ScaleInt(44);
        var iconGap = ScaleInt(16);
        var buttonHeight = ScaleInt(ButtonHeight);
        var gap = ScaleInt(12);

        var textX = cardX + inset + iconSize + iconGap;
        var textRight = cardX + cardW - inset;
        var textW = textRight - textX;

        var measured = TextRenderer.MeasureText(
            _message, Font, new Size(textW, int.MaxValue),
            TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
        var lineHeight = TextRenderer.MeasureText("测", Font).Height;
        var contentH = Math.Max(measured.Height + lineHeight, iconSize); // 留一行余量兜底

        var textTop = cardY + inset;
        var buttonTop = textTop + contentH + ScaleInt(22);
        var cardBottom = buttonTop + buttonHeight + inset;
        _cardRect = new Rectangle(cardX, cardY, cardW, cardBottom - cardY);
        ClientSize = new Size(dialogWidth, cardBottom + ScaleInt(20));

        Controls.Add(new DialogIcon
        {
            Kind = _kind,
            Location = new Point(cardX + inset, textTop),
            Size = new Size(iconSize, iconSize),
            BackColor = Card
        });

        Controls.Add(new Label
        {
            AutoSize = false,
            Location = new Point(textX, textTop),
            Size = new Size(textW, contentH),
            Text = _message,
            ForeColor = TextColor,
            BackColor = Card,
            TextAlign = ContentAlignment.TopLeft,
            UseMnemonic = false
        });

        // 按钮从右向左排列，宽度随文字自适应（中文长按钮不再被截断）。
        var right = cardX + cardW;
        foreach (var action in actions.Reverse())
        {
            var textWidth = TextRenderer.MeasureText(action.Text, Font).Width;
            var width = Math.Max(ScaleInt(92), textWidth + ScaleInt(36));
            right -= width;
            var button = BuildButton(action, new Point(right, buttonTop), width, buttonHeight);
            Controls.Add(button);
            right -= gap;
        }
    }

    private Button BuildButton(DialogAction action, Point location, int width, int height)
    {
        var button = new Button
        {
            Text = action.Text,
            DialogResult = action.Result,
            Location = location,
            Size = new Size(width, height),
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

public sealed class ProgressDialog : ScaledForm
{
    private static readonly Color Background = Color.FromArgb(242, 247, 248);
    private static readonly Color Card = Color.White;
    private static readonly Color TextColor = Color.FromArgb(18, 27, 34);
    private static readonly Color Muted = Color.FromArgb(93, 111, 121);
    private static readonly Color Line = Color.FromArgb(218, 229, 233);

    private readonly Label _message = new();
    private readonly ProgressBar _progress = new();
    private readonly string _initialMessage;
    private Rectangle _cardRect = new(24, 24, 372, 92);
    private bool _built;

    public ProgressDialog(string title, string message)
    {
        _initialMessage = message;
        AutoScaleMode = AutoScaleMode.None;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;
        StartPosition = FormStartPosition.CenterParent;
        Text = title;
        BackColor = Background;
        Font = new Font("Microsoft YaHei UI", 10F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    }

    protected override void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        if (!_built)
        {
            _built = true;
            BuildUi(_initialMessage);
            if (Owner is { } owner)
            {
                var x = owner.Left + (owner.Width - Width) / 2;
                var y = owner.Top + (owner.Height - Height) / 2;
                Location = new Point(Math.Max(0, x), Math.Max(0, y));
            }
        }
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
        using var card = RoundedRect(_cardRect, ScaleInt(14));
        e.Graphics.FillPath(cardBrush, card);
        e.Graphics.DrawPath(linePen, card);
    }

    private void BuildUi(string message)
    {
        // 手动按当前 DPI 缩放为设备像素，单一坐标系与 OnPaint 一致。
        var dialogWidth = ScaleInt(420);
        var cardX = ScaleInt(24);
        var cardY = ScaleInt(24);
        var cardW = dialogWidth - cardX * 2;
        var cardH = ScaleInt(92);
        _cardRect = new Rectangle(cardX, cardY, cardW, cardH);
        ClientSize = new Size(dialogWidth, ScaleInt(150));

        var inset = ScaleInt(16);
        _message.Location = new Point(cardX + inset, cardY + ScaleInt(24));
        _message.Size = new Size(cardW - inset * 2, ScaleInt(28));
        _message.AutoEllipsis = true;
        _message.UseMnemonic = false;
        _message.Text = message;
        _message.ForeColor = Muted;
        _message.BackColor = Card;
        Controls.Add(_message);

        _progress.Location = new Point(cardX + inset, cardY + ScaleInt(64));
        _progress.Size = new Size(cardW - inset * 2, ScaleInt(12));
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
