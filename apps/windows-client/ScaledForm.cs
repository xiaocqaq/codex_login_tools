namespace CodexLoginTools.Win;

/// <summary>
/// 所有窗体的共享基类：统一开启 DPI 字体自适应，并提供 DPI 感知的自绘辅助。
/// 手写像素布局的窗体只要继承本类，控件位置/尺寸即随系统缩放正确放大；
/// OnPaint 中的自绘图形改用 <see cref="ScaleInt"/> / <see cref="ScaleRect"/> 即可与控件对齐。
/// </summary>
public abstract class ScaledForm : Form
{
    // 设计稿基准 DPI（96 = 100% 缩放）。
    private const float DesignDpi = 96f;

    protected ScaledForm()
    {
        // Font 模式：按窗体字体在不同 DPI 下的高度差自动缩放子控件布局。
        AutoScaleMode = AutoScaleMode.Font;
    }

    /// <summary>当前 DPI 相对设计基准的缩放因子（100% = 1.0，150% = 1.5）。</summary>
    protected float ScaleFactor => DeviceDpi / DesignDpi;

    /// <summary>将设计像素值按当前 DPI 缩放为设备像素。</summary>
    protected int ScaleInt(int value) => (int)Math.Round(value * ScaleFactor);

    /// <summary>将设计像素矩形按当前 DPI 缩放为设备像素矩形，供 OnPaint 使用。</summary>
    protected Rectangle ScaleRect(int x, int y, int width, int height) =>
        new(ScaleInt(x), ScaleInt(y), ScaleInt(width), ScaleInt(height));
}
