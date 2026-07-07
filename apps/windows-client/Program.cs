namespace CodexLoginTools.Win;

static class Program
{
    /// <summary>
    ///  The main entry point for the application.
    /// </summary>
    [STAThread]
    static void Main()
    {
        try
        {
            ClientLog.Write("starting");
            ApplicationConfiguration.Initialize();
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += (_, error) => ClientLog.Write(error.Exception.ToString());
            AppDomain.CurrentDomain.UnhandledException += (_, error) =>
                ClientLog.Write(error.ExceptionObject?.ToString() ?? "unknown unhandled exception");
            ClientLog.Write("running main form");
            Application.Run(new MainForm());
            ClientLog.Write("main form closed");
        }
        catch (Exception error)
        {
            ClientLog.Write(error.ToString());
            MessageBox.Show(error.Message, "启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }    
}
