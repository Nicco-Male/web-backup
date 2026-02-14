import { create } from "@bufbuild/protobuf";
import { readFileSync } from "node:fs";
import { Protobuf } from "@meshtastic/core";
import { describe, expect, it } from "vitest";
import { createConfigBackupYaml, parseConfigBackupYaml } from "./configBackup.ts";

describe("createConfigBackupYaml", () => {
  const createSamplePayload = () => {
    const channels = new Map([
      [
        1,
        create(Protobuf.Channel.ChannelSchema, {
          index: 1,
          role: Protobuf.Channel.Channel_Role.SECONDARY,
          settings: {
            name: "Second",
            psk: new Uint8Array([1, 2, 3]),
          },
        }),
      ],
      [
        0,
        create(Protobuf.Channel.ChannelSchema, {
          index: 0,
          role: Protobuf.Channel.Channel_Role.PRIMARY,
          settings: {
            name: "Primary",
            uplinkEnabled: true,
          },
        }),
      ],
    ]);

    const config = create(Protobuf.LocalOnly.LocalConfigSchema, {
      device: {
        role: Protobuf.Config.Config_DeviceConfig_Role.CLIENT,
      },
    });

    const moduleConfig = create(Protobuf.LocalOnly.LocalModuleConfigSchema, {
      telemetry: {
        updateInterval: 60,
      },
    });

    return { channels, config, moduleConfig };
  };

  it("matches a CLI-style golden export", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());
    const goldenYaml = readFileSync(
      new URL("./__fixtures__/meshtastic-cli-export.golden.yaml", import.meta.url),
      "utf8",
    );

    expect(yaml).toBe(goldenYaml);
  });

  it("keeps canonical top-level section order", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    const configIndex = yaml.indexOf("config:");
    const moduleConfigIndex = yaml.indexOf("module_config:");
    const channelsIndex = yaml.indexOf("channels:");

    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(moduleConfigIndex).toBeGreaterThan(configIndex);
    expect(channelsIndex).toBeGreaterThan(moduleConfigIndex);
  });

  it("serializes enums/booleans and keeps pure CLI structure", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain("role: \"CLIENT\"");
    expect(yaml).toContain("role: \"PRIMARY\"");
    expect(yaml).toContain("uplink_enabled: true");
    expect(yaml).not.toContain("meshtastic-web-config-backup-v1");
    expect(yaml).not.toContain("generatedAt");
    expect(yaml).not.toContain("format:");
  });

  it("uses CLI-compatible base64 encoding for bytes and no JSON null sentinels", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain('psk: "AQID"');
    expect(yaml).not.toContain(": undefined");
  });
});

describe("parseConfigBackupYaml", () => {
  it("validates a generated yaml backup", () => {
    const channels = new Map([
      [
        0,
        create(Protobuf.Channel.ChannelSchema, {
          index: 0,
          settings: {
            name: "Primary",
          },
        }),
      ],
    ]);

    const config = create(Protobuf.LocalOnly.LocalConfigSchema, {
      device: {
        role: Protobuf.Config.Config_DeviceConfig_Role.CLIENT,
      },
    });

    const moduleConfig = create(Protobuf.LocalOnly.LocalModuleConfigSchema, {
      telemetry: {
        updateInterval: 60,
      },
    });

    const yaml = createConfigBackupYaml({ channels, config, moduleConfig });
    const parsed = parseConfigBackupYaml(yaml);

    expect(parsed.errors).toEqual([]);
    expect(parsed.backup?.channels.length).toBe(1);
  });

  it("returns error for malformed yaml", () => {
    const parsed = parseConfigBackupYaml("not-yaml");
    expect(parsed.errors).toContain("invalidFile");
  });
});
