import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from "electron";
import electronUpdater from "electron-updater";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCodexInstallService } from "./codex-install-service.js";
import { GatewayController } from "./gateway-controller.js";
import {
  defaultDesktopSettings,
  loadDesktopSettings,
  saveDesktopSettings,
  type DesktopSettings,
} from "./settings-store.js";
import { createUpdateService } from "./update-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { autoUpdater } = electronUpdater;
const appRoot = join(__dirname, "..", "..");
const settingsPath = join(app.getPath("userData"), "settings.json");
const codexConfigPath = join(app.getPath("home"), ".codex", "config.toml");

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let settings: DesktopSettings = defaultDesktopSettings;
let isQuitting = false;

const gateway = new GatewayController({
  getSettings: () => settings,
  getCodexConfigPath: () => codexConfigPath,
});
const codexInstall = createCodexInstallService();
const updates = createUpdateService(autoUpdater, app.isPackaged);

app.setLoginItemSettings({ openAtLogin: false });

await app.whenReady();
settings = await loadDesktopSettings(settingsPath);
app.setLoginItemSettings({ openAtLogin: settings.startOnLaunch });

registerIpc();
createMainWindow();
createTray();

if (settings.startOnLaunch) {
  await gateway.start();
  if (settings.writeCodexConfigOnStart) {
    await gateway.writeCodexConfig().catch(() => undefined);
  }
  pushStatus();
}

setInterval(() => {
  gateway.flushUsage().catch(() => undefined);
}, 60000).unref();

app.on("activate", () => {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  mainWindow.show();
});

app.on("window-all-closed", () => undefined);

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    title: "Codex Login Tools",
    show: false,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(appRoot, "public", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAfElEQVR4AWP4//8/AyUYTFhYWDh06NABxP//PwPDw8MZGBgYGL4zg8GCEQyg4T8DAwPDfwwMDAwMDIwMDD8zMDAwMDAwMDwHwYGhv8MDAwMDAwMDAz/MTAwMPxnYGBgYGD4z8DAwMCQkJCAsWPHGhoaGhjQxHAxQHkQxHAxgARbsiE2uGi3AAAAAElFTkSuQmCC",
  );
  tray = new Tray(icon);
  tray.setToolTip("Codex Login Tools");
  updateTrayMenu();
  tray.on("click", () => {
    mainWindow?.show();
  });
}

function updateTrayMenu(): void {
  const status = gateway.getStatus();
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: status.running ? "Stop gateway" : "Start gateway",
        click: () => void toggleGateway(),
      },
      {
        label: "Show window",
        click: () => mainWindow?.show(),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => void quitApp(),
      },
    ]),
  );
}

function registerIpc(): void {
  ipcMain.handle("desktop:get-state", async () => ({
    settings,
    gateway: gateway.getStatus(),
    codex: await codexInstall.checkStatus(),
  }));

  ipcMain.handle("desktop:save-settings", async (_event, nextSettings: DesktopSettings) => {
    settings = { ...defaultDesktopSettings, ...nextSettings };
    await saveDesktopSettings(settingsPath, settings);
    app.setLoginItemSettings({ openAtLogin: settings.startOnLaunch });
    return { settings, gateway: gateway.getStatus(), codex: await codexInstall.checkStatus() };
  });

  ipcMain.handle("desktop:start-gateway", async () => {
    const status = await gateway.start();
    updateTrayMenu();
    return status;
  });

  ipcMain.handle("desktop:stop-gateway", async () => {
    const status = await gateway.stop();
    updateTrayMenu();
    return status;
  });

  ipcMain.handle("desktop:refresh-config", async () => gateway.refreshConfig());
  ipcMain.handle("desktop:write-codex-config", async () => {
    await gateway.writeCodexConfig();
    return { ok: true };
  });
  ipcMain.handle("desktop:check-updates", async () => updates.checkForUpdates());
  ipcMain.handle("desktop:check-codex", async () => codexInstall.checkStatus());
  ipcMain.handle("desktop:install-codex", async () => codexInstall.install());
}

async function toggleGateway(): Promise<void> {
  if (gateway.getStatus().running) {
    await gateway.stop();
  } else {
    await gateway.start();
  }
  updateTrayMenu();
  pushStatus();
}

function pushStatus(): void {
  mainWindow?.webContents.send("desktop:status", gateway.getStatus());
}

async function quitApp(): Promise<void> {
  isQuitting = true;
  await gateway.stop();
  app.exit(0);
}
