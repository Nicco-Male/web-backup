import { create, toBinary } from "@bufbuild/protobuf";
import { Protobuf } from "@meshtastic/core";
import { fromByteArray } from "base64-js";
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

  it("matches the meshtastic cli backup layout", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());
    expect(yaml).toContain("# start of Meshtastic configure yaml");
    expect(yaml).toContain("config:");
    expect(yaml).toContain("module_config:");
    expect(yaml).toContain("channels:");
    expect(yaml).not.toContain("generatedAt:");
    expect(yaml).not.toContain("format:");
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

  it("serializes enums as names for cli compatibility", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain("role: CLIENT");
    expect(yaml).toContain("role: PRIMARY");
    expect(yaml).toContain("uplink_enabled: true");
  });

  it("uses CLI-compatible base64 encoding for bytes", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain("psk: base64:AQID");
    expect(yaml).not.toContain(": undefined");
    expect(yaml).not.toContain("$typeName");
  });

  it("serializes with 2-space indentation and deterministic sections", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain("\n  device:\n");
    expect(yaml).toContain("\n  telemetry:\n");
    expect(yaml).toContain("\n  - index: 0\n");
    expect(yaml).toContain("\n  - index: 1\n");
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

  it("accepts CLI-like yaml with comments, special strings, empty arrays, and base64 values", () => {
    const parsed = parseConfigBackupYaml(`
# start of Meshtastic configure yaml
config:
  security:
    public_key: "base64:r7O4pSccIMGXCUlCJFJUfxlUtvnNF2+nyADtGj8i9C8="
    private_key: base64:IKhkOAphNZr4U948HkKx+J09hK7BHCAFvvQVICwBkEc=
module_config:
  mqtt:
    enabled: true
    address: "192.168.10.202:1883"
    root: "node/#42?test=true"
  external_notification:
    enabled_alert_bell: []
channels:
  - index: 0
    role: PRIMARY
    settings:
      name: "Primary #1"
      psk: base64:AQ==
`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.backup?.channels[0]?.settings.psk).toEqual(new Uint8Array([1]));
    expect(parsed.backup?.moduleConfig.mqtt?.address).toBe("192.168.10.202:1883");
  });

  it("returns error for malformed yaml", () => {
    const parsed = parseConfigBackupYaml("config:\n  - invalid");
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

  it("accepts restore yaml without channels", () => {
    const parsed = parseConfigBackupYaml(`
config:
  device:
    role: CLIENT
module_config:
  telemetry:
    update_interval: 60
`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.backup?.channels).toEqual([]);
  });

  it("maps channel_url to internal channel payload", () => {
    const channelSet = create(Protobuf.AppOnly.ChannelSetSchema, {
      settings: [
        create(Protobuf.Channel.ChannelSettingsSchema, {
          name: "Primary",
        }),
        create(Protobuf.Channel.ChannelSettingsSchema, {
          name: "Secondary",
        }),
      ],
    });
    const encoded = fromByteArray(toBinary(Protobuf.AppOnly.ChannelSetSchema, channelSet))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const parsed = parseConfigBackupYaml(`
config:
  device:
    role: CLIENT
module_config:
  telemetry:
    update_interval: 60
channel_url: https://meshtastic.org/e/#${encoded}
`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.backup?.channels).toHaveLength(2);
    expect(parsed.backup?.channels[0]?.role).toBe(Protobuf.Channel.Channel_Role.PRIMARY);
    expect(parsed.backup?.channels[1]?.index).toBe(1);
  });
});
