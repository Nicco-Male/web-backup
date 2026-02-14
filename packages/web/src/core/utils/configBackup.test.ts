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

    return {
      channels,
      config,
      moduleConfig,
      owner: "Meshtastic Tester",
      ownerShort: "MTST",
      location: { latitudeI: 451234567, longitudeI: 91234567 },
      cannedMessages: ["hello", "world"],
    };
  };

  it("matches the meshtastic cli backup layout", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());
    expect(yaml).toContain("# start of Meshtastic configure yaml");
    expect(yaml).toContain("config:");
    expect(yaml).toContain("module_config:");
    expect(yaml).toContain("canned_messages: \"hello|world\"");
    expect(yaml).toContain("channel_url: https://meshtastic.org/e/#");
    expect(yaml).toContain("owner: \"Meshtastic Tester\"");
    expect(yaml).toContain("owner_short: MTST");
    expect(yaml).toContain("location:");
    expect(yaml).toContain("lat: 45.1234567");
    expect(yaml).toContain("lon: 9.1234567");
    expect(yaml).not.toContain("channels:");
    expect(yaml).not.toContain("generatedAt:");
    expect(yaml).not.toContain("format:");
  });

  it("keeps canonical top-level section order", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    const cannedIndex = yaml.indexOf("canned_messages:");
    const channelUrlIndex = yaml.indexOf("channel_url:");
    const configIndex = yaml.indexOf("config:");
    const locationIndex = yaml.indexOf("location:");
    const moduleConfigIndex = yaml.indexOf("module_config:");
    const ownerIndex = yaml.indexOf("owner:");
    const ownerShortIndex = yaml.indexOf("owner_short:");

    expect(cannedIndex).toBeGreaterThanOrEqual(0);
    expect(channelUrlIndex).toBeGreaterThan(cannedIndex);
    expect(configIndex).toBeGreaterThan(channelUrlIndex);
    expect(locationIndex).toBeGreaterThan(configIndex);
    expect(moduleConfigIndex).toBeGreaterThan(locationIndex);
    expect(ownerIndex).toBeGreaterThan(moduleConfigIndex);
    expect(ownerShortIndex).toBeGreaterThan(ownerIndex);
  });

  it("serializes enums as names for cli compatibility", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain("role: CLIENT");
    expect(yaml).toContain("role: PRIMARY");
    expect(yaml).toContain("uplink_enabled: true");
  });

  it("uses CLI-compatible base64 encoding for bytes", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain('psk: "base64:AQID"');
    expect(yaml).not.toContain(": undefined");
    expect(yaml).not.toContain("$typeName");
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


  it("accepts CLI base64: prefixed secret values", () => {
    const parsed = parseConfigBackupYaml(`
config:
  security:
    public_key: base64:r7O4pSccIMGXCUlCJFJUfxlUtvnNF2+nyADtGj8i9C8=
    private_key: base64:IKhkOAphNZr4U948HkKx+J09hK7BHCAFvvQVICwBkEc=
module_config:
  telemetry:
    update_interval: 60
channels:
  -
    index: 0
    settings:
      psk: base64:AQ==
`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.backup?.channels[0]?.settings.psk).toEqual(new Uint8Array([1]));
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
