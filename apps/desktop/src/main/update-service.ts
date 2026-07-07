export interface UpdateCheckResult {
  status: "disabled" | "checking" | "error";
  message?: string;
}

export interface AppUpdaterLike {
  checkForUpdatesAndNotify: () => Promise<unknown>;
}

export interface UpdateService {
  checkForUpdates: () => Promise<UpdateCheckResult>;
}

export function createUpdateService(
  updater: AppUpdaterLike,
  enabled: boolean,
): UpdateService {
  return {
    async checkForUpdates() {
      if (!enabled) {
        return { status: "disabled" };
      }

      try {
        await updater.checkForUpdatesAndNotify();
        return { status: "checking" };
      } catch (error) {
        return {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
