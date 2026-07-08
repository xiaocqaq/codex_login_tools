using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace CodexLoginTools.Win;

public static class DeviceIdentity
{
    private static string? _cachedId;

    public static string DeviceName => Environment.MachineName;

    public static string DeviceId
    {
        get
        {
            if (!string.IsNullOrEmpty(_cachedId))
            {
                return _cachedId!;
            }

            _cachedId = ResolveDeviceId();
            return _cachedId;
        }
    }

    private static string ResolveDeviceId()
    {
        var machineGuid = TryReadMachineGuid();
        if (!string.IsNullOrWhiteSpace(machineGuid))
        {
            return Hash(machineGuid!);
        }

        return FallbackId();
    }

    private static string? TryReadMachineGuid()
    {
        try
        {
            using var key = RegistryKey
                .OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64)
                .OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
            return key?.GetValue("MachineGuid") as string;
        }
        catch (Exception error)
        {
            ClientLog.Write("read MachineGuid failed: " + error.Message);
            return null;
        }
    }

    private static string FallbackId()
    {
        var settings = SettingsStore.Load();
        if (!string.IsNullOrWhiteSpace(settings.DeviceId))
        {
            return settings.DeviceId;
        }

        var generated = Hash(Guid.NewGuid().ToString("N"));
        settings.DeviceId = generated;
        try
        {
            SettingsStore.Save(settings);
        }
        catch (Exception error)
        {
            ClientLog.Write("persist fallback device id failed: " + error.Message);
        }

        return generated;
    }

    private static string Hash(string input)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}
