namespace CodexLoginTools.Win;

public sealed class TutorialDialog : Form
{
    private static readonly Color Background = Color.FromArgb(242, 247, 248);
    private static readonly Color Card = Color.White;
    private static readonly Color Primary = Color.FromArgb(18, 111, 126);
    private static readonly Color PrimaryHover = Color.FromArgb(13, 94, 108);
    private static readonly Color Muted = Color.FromArgb(93, 111, 121);
    private static readonly Color Line = Color.FromArgb(218, 229, 233);
    private static readonly Color TextColor = Color.FromArgb(18, 27, 34);
    private static readonly Color DotActive = Primary;
    private static readonly Color DotInactive = Color.FromArgb(200, 210, 215);

    private const int ImageWidth = 640;
    private const int ImageHeight = 507;
    private const int EdgePad = 32;
    private const int DotSize = 10;
    private const int DotSpacing = 8;
    private const int ButtonHeight = 40;
    private const int FooterHeight = 70;

    private readonly PictureBox _imageBox = new();
    private readonly Panel _dotPanel = new();
    private readonly Button _prevButton;
    private readonly Button _nextButton;
    private readonly Button _skipButton;
    private readonly Image[] _images;
    private int _currentPage;

    public TutorialDialog(Image[] images)
    {
        _images = images.Length > 0 ? images : [CreatePlaceholder("暂无教程图片")];
        _prevButton = BuildNavButton("上一步", false);
        _nextButton = BuildNavButton("下一步", true);
        _skipButton = BuildNavButton("跳过", false);

        AutoScaleMode = AutoScaleMode.None;
        var dialogWidth = ImageWidth + EdgePad * 2;
        var dialogHeight = EdgePad + ImageHeight + 40 + FooterHeight;
        ClientSize = new Size(dialogWidth, dialogHeight);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterParent;
        Text = "使用教程";
        BackColor = Background;
        Font = new Font("Microsoft YaHei UI", 10F);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        BuildUi();
        ShowPage(0);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        base.OnFormClosed(e);
        foreach (var img in _images)
        {
            img.Dispose();
        }
    }

    private void BuildUi()
    {
        SuspendLayout();

        _imageBox.Location = new Point(EdgePad, EdgePad);
        _imageBox.Size = new Size(ImageWidth, ImageHeight);
        _imageBox.SizeMode = PictureBoxSizeMode.Zoom;
        _imageBox.BackColor = Card;
        Controls.Add(_imageBox);

        _dotPanel.Location = new Point(EdgePad, EdgePad + ImageHeight + 8);
        _dotPanel.Size = new Size(ImageWidth, 24);
        _dotPanel.BackColor = Background;
        Controls.Add(_dotPanel);

        var footerY = EdgePad + ImageHeight + 40;

        _skipButton.Location = new Point(EdgePad, footerY + (FooterHeight - ButtonHeight) / 2);
        _skipButton.Size = new Size(80, ButtonHeight);
        _skipButton.BackColor = Color.White;
        _skipButton.ForeColor = Muted;
        _skipButton.FlatAppearance.BorderColor = Line;
        _skipButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(232, 241, 244);
        _skipButton.Click += (_, _) => Close();
        Controls.Add(_skipButton);

        _prevButton.Location = new Point(ClientSize.Width - EdgePad - 200, footerY + (FooterHeight - ButtonHeight) / 2);
        _prevButton.Size = new Size(92, ButtonHeight);
        _prevButton.BackColor = Color.White;
        _prevButton.ForeColor = Primary;
        _prevButton.FlatAppearance.BorderColor = Line;
        _prevButton.FlatAppearance.MouseOverBackColor = Color.FromArgb(232, 241, 244);
        _prevButton.Click += (_, _) => ShowPage(_currentPage - 1);
        Controls.Add(_prevButton);

        _nextButton.Location = new Point(ClientSize.Width - EdgePad - 100, footerY + (FooterHeight - ButtonHeight) / 2);
        _nextButton.Size = new Size(100, ButtonHeight);
        _nextButton.BackColor = Primary;
        _nextButton.ForeColor = Color.White;
        _nextButton.FlatAppearance.BorderColor = Primary;
        _nextButton.FlatAppearance.MouseOverBackColor = PrimaryHover;
        _nextButton.Click += (_, _) =>
        {
            if (_currentPage >= _images.Length - 1)
            {
                Close();
            }
            else
            {
                ShowPage(_currentPage + 1);
            }
        };
        Controls.Add(_nextButton);

        ResumeLayout(false);
    }

    private void ShowPage(int page)
    {
        _currentPage = Math.Clamp(page, 0, _images.Length - 1);
        _imageBox.Image = _images[_currentPage];

        _prevButton.Visible = _currentPage > 0;
        var isLast = _currentPage >= _images.Length - 1;
        _nextButton.Text = isLast ? "开始使用" : "下一步";
        _skipButton.Visible = !isLast;

        RebuildDots();
    }

    private void RebuildDots()
    {
        _dotPanel.Controls.Clear();
        if (_images.Length <= 1) return;

        var totalWidth = _images.Length * DotSize + (_images.Length - 1) * DotSpacing;
        var startX = (ImageWidth - totalWidth) / 2;

        for (var i = 0; i < _images.Length; i++)
        {
            var dot = new DotIndicator
            {
                Location = new Point(startX + i * (DotSize + DotSpacing), (24 - DotSize) / 2),
                Size = new Size(DotSize, DotSize),
                Active = i == _currentPage,
                BackColor = Background
            };
            var index = i;
            dot.Click += (_, _) => ShowPage(index);
            dot.Cursor = Cursors.Hand;
            _dotPanel.Controls.Add(dot);
        }
    }

    private static Button BuildNavButton(string text, bool primary)
    {
        var button = new Button
        {
            Text = text,
            FlatStyle = FlatStyle.Flat,
            Cursor = Cursors.Hand,
            Font = new Font("Microsoft YaHei UI", 10F, FontStyle.Bold)
        };
        return button;
    }

    public static Image[] LoadTutorialImages()
    {
        try
        {
            var assembly = System.Reflection.Assembly.GetExecutingAssembly();
            var resourceNames = assembly.GetManifestResourceNames()
                .Where(name => name.Contains(".Assets.tutorial.", StringComparison.OrdinalIgnoreCase))
                .Where(name =>
                {
                    var ext = Path.GetExtension(name).ToLowerInvariant();
                    return ext is ".png" or ".jpg" or ".jpeg" or ".bmp" or ".gif";
                })
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToArray();

            if (resourceNames.Length == 0)
            {
                return CreateDefaultPlaceholders();
            }

            var images = new List<Image>();
            foreach (var name in resourceNames)
            {
                using var stream = assembly.GetManifestResourceStream(name);
                if (stream is null)
                {
                    continue;
                }

                // Copy to a memory stream so the Image does not depend on the disposed resource stream.
                using var memory = new MemoryStream();
                stream.CopyTo(memory);
                memory.Position = 0;
                images.Add(Image.FromStream(memory));
            }

            return images.Count > 0 ? images.ToArray() : CreateDefaultPlaceholders();
        }
        catch
        {
            return CreateDefaultPlaceholders();
        }
    }

    private static Image[] CreateDefaultPlaceholders()
    {
        return
        [
            CreatePlaceholder("第 1 步：在设置中填写 Token"),
            CreatePlaceholder("第 2 步：点击「启动代理」"),
            CreatePlaceholder("第 3 步：打开 Codex 桌面版开始使用"),
        ];
    }

    private static Image CreatePlaceholder(string text)
    {
        var bitmap = new Bitmap(ImageWidth, ImageHeight);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        graphics.Clear(Color.FromArgb(245, 248, 250));

        using var borderPen = new Pen(Color.FromArgb(200, 210, 215), 2);
        graphics.DrawRectangle(borderPen, 1, 1, ImageWidth - 3, ImageHeight - 3);

        using var iconBrush = new SolidBrush(Color.FromArgb(180, 195, 205));
        var iconRect = new Rectangle(ImageWidth / 2 - 30, ImageHeight / 2 - 60, 60, 60);
        graphics.FillEllipse(iconBrush, iconRect);

        using var font = new Font("Microsoft YaHei UI", 16F);
        using var textBrush = new SolidBrush(Color.FromArgb(93, 111, 121));
        var textSize = graphics.MeasureString(text, font);
        graphics.DrawString(text, font, textBrush,
            (ImageWidth - textSize.Width) / 2,
            ImageHeight / 2 + 30);

        using var hintFont = new Font("Microsoft YaHei UI", 11F);
        using var hintBrush = new SolidBrush(Color.FromArgb(160, 175, 185));
        const string hint = "请将教程图片放入 Assets/tutorial 目录";
        var hintSize = graphics.MeasureString(hint, hintFont);
        graphics.DrawString(hint, hintFont, hintBrush,
            (ImageWidth - hintSize.Width) / 2,
            ImageHeight / 2 + 70);

        return bitmap;
    }

    private sealed class DotIndicator : Control
    {
        [System.ComponentModel.DesignerSerializationVisibility(System.ComponentModel.DesignerSerializationVisibility.Hidden)]
        public bool Active { get; set; }

        public DotIndicator()
        {
            SetStyle(
                ControlStyles.AllPaintingInWmPaint |
                ControlStyles.OptimizedDoubleBuffer |
                ControlStyles.ResizeRedraw |
                ControlStyles.UserPaint,
                true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var fill = new SolidBrush(Active ? DotActive : DotInactive);
            e.Graphics.FillEllipse(fill, 0, 0, Width - 1, Height - 1);
        }
    }
}
