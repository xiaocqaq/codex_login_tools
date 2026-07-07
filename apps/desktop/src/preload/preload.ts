import { contextBridge, ipcRenderer } from "electron";
import type { DesktopSettings } from "../main/settings-store.js";
import type { CodexInstallResult, CodexStatus } from "../main/codex-install-service.js";
import type { GatewayStatus } from "../main/gateway-controller.js";
import type { UpdateCheckResult } from "../main/update-service.js";

export interface DesktopState {
  settings: DesktopSettings;
  gateway: GatewayStatus;
  codex: CodexStatus;
}

const api = {
  getState: () => ipcRenderer.invoke("desktop:get-state") as Promise<DesktopState>,
  saveSettings: (settings: DesktopSettings) =>
    ipcRenderer.invoke("desktop:save-settings", settings) as Promise<DesktopState>,
  startGateway: () => ipcRenderer.invoke("desktop:start-gateway") as Promise<GatewayStatus>,
  stopGateway: () => ipcRenderer.invoke("desktop:stop-gateway") as Promise<GatewayStatus>,
  refreshConfig: () => ipcRenderer.invoke("desktop:refresh-config") as Promise<GatewayStatus>,
  writeCodexConfig: () => ipcRenderer.invoke("desktop:write-codex-config") as Promise<{ ok: true }>,
  checkUpdates: () => ipcRenderer.invoke("desktop:check-updates") as Promise<UpdateCheckResult>,
  checkCodex: () => ipcRenderer.invoke("desktop:check-codex") as Promise<CodexStatus>,
  installCodex: () => ipcRenderer.invoke("desktop:install-codex") as Promise<CodexInstallResult>,
  onStatus: (callback: (status: GatewayStatus) => void) => {
    ipcRenderer.on("desktop:status", (_event, status: GatewayStatus) => callback(status));
  },
};

contextBridge.exposeInMainWorld("codexDesktop", api);

export type CodexDesktopApi = typeof api;
