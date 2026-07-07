import { describe, expect, it, vi } from "vitest";
import { createUpdateService } from "../src/main/update-service.js";

describe("update service", () => {
  it("does not call the updater when updates are disabled", async () => {
    const updater = {
      checkForUpdatesAndNotify: vi.fn(),
    };
    const service = createUpdateService(updater, false);

    const result = await service.checkForUpdates();

    expect(result.status).toBe("disabled");
    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
  });

  it("checks for updates when updates are enabled", async () => {
    const updater = {
      checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
    };
    const service = createUpdateService(updater, true);

    const result = await service.checkForUpdates();

    expect(result.status).toBe("checking");
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
  });
});
