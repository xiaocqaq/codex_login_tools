import { execFile, spawn } from "node:child_process";
import { platform } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const windowsInstallCommand = "irm https://chatgpt.com/codex/install.ps1 | iex";

export interface CodexStatus {
  installed: boolean;
  command?: string;
  message?: string;
}

export interface CodexInstallResult {
  started: boolean;
  message: string;
}

export interface CodexInstallService {
  checkStatus: () => Promise<CodexStatus>;
  install: () => Promise<CodexInstallResult>;
}

export function createCodexInstallService(): CodexInstallService {
  return {
    async checkStatus() {
      return checkCodexStatus();
    },
    async install() {
      return installCodex();
    },
  };
}

async function checkCodexStatus(): Promise<CodexStatus> {
  const command = platform() === "win32" ? "where" : "which";

  try {
    const { stdout } = await execFileAsync(command, ["codex"], { timeout: 5000 });
    const firstLine = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
    return {
      installed: true,
      command: firstLine?.trim() ?? "codex",
    };
  } catch {
    return {
      installed: false,
      message: "未检测到 Codex CLI",
    };
  }
}

async function installCodex(): Promise<CodexInstallResult> {
  if (platform() !== "win32") {
    return {
      started: false,
      message: "当前只内置了 Windows 官方安装命令，请前往 OpenAI Codex 官方页面安装。",
    };
  }

  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", windowsInstallCommand],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();

  return {
    started: true,
    message: "已开始通过 OpenAI 官方安装脚本安装 Codex CLI。",
  };
}
