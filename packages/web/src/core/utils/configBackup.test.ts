import { create } from "@bufbuild/protobuf";
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

  it("matches the meshtastic web backup envelope format", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());
    expect(yaml).toContain('generatedAt: "');
    expect(yaml).toContain('format: "meshtastic-web-config-backup-v1"');
    expect(yaml).toContain('moduleConfig:');
    expect(yaml).toContain('$typeName: "meshtastic.LocalConfig"');
    expect(yaml).toContain('$typeName: "meshtastic.LocalModuleConfig"');
  });

  it("keeps canonical top-level section order", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    const configIndex = yaml.indexOf("config:");
    const moduleConfigIndex = yaml.indexOf("moduleConfig:");
    const channelsIndex = yaml.indexOf("channels:");

    expect(configIndex).toBeGreaterThanOrEqual(0);
    expect(moduleConfigIndex).toBeGreaterThan(configIndex);
    expect(channelsIndex).toBeGreaterThan(moduleConfigIndex);
  });

  it("serializes enums as numbers and keeps metadata fields", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain("role: 12");
    expect(yaml).toContain("role: 1");
    expect(yaml).toContain("uplink_enabled: true");
    expect(yaml).toContain("generatedAt");
    expect(yaml).toContain("format:");
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

  it("accepts CLI-like yaml with comments and plain scalars", () => {
    const parsed = parseConfigBackupYaml(`
# start of Meshtastic configure yaml
config:
  device:
    role: CLIENT
module_config:
  mqtt:
    enabled: true
    address: 192.168.10.202
channels:
  -
    index: 0
    role: PRIMARY
    settings:
      psk: AQ==
`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.backup?.channels[0]?.index).toBe(0);
  });
});
