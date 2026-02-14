import channelsEN from "@public/i18n/locales/en/channels.json" with { type: "json" };
import { describe, expect, it } from "vitest";

describe("backup i18n copy", () => {
  it("matches the approved english backup/export labels", () => {
    expect({
      exportCli: channelsEN.page.exportCli,
      exportCliDescription: channelsEN.page.exportCliDescription,
      exportWeb: channelsEN.page.exportWeb,
      exportWebDescription: channelsEN.page.exportWebDescription,
      backupCompatibilityLabel: channelsEN.page.backupCompatibilityLabel,
    }).toMatchInlineSnapshot(`
      {
        "backupCompatibilityLabel": "Compatibility: CLI standard export + Web internal full backup",
        "exportCli": "Export standard CLI",
        "exportCliDescription": "CLI-compatible channel export (URL / QR). Restorable in CLI and Web import.",
        "exportWeb": "Export Web complete",
        "exportWebDescription": "Web internal backup policy: full device config YAML for Meshtastic Web restore workflows.",
      }
    `);
  });
});
