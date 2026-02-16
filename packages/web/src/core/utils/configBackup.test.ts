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
      network: {
        ntpServer: "pool.ntp.org",
      },
    });

    const moduleConfig = create(Protobuf.LocalOnly.LocalModuleConfigSchema, {
      mqtt: {
        enabled: true,
        address: "192.168.10.202",
      },
    });

    return { channels, config, moduleConfig };
  };

  it("matches the meshtastic cli backup layout", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());
    expect(yaml).toContain("# start of Meshtastic configure yaml");
    expect(yaml).toContain("canned_messages:");
    expect(yaml).toContain("channel_url: https://meshtastic.org/e/#");
    expect(yaml).toContain("config:");
    expect(yaml).toContain("module_config:");
    expect(yaml).not.toContain("generatedAt:");
    expect(yaml).not.toContain("format:");
  });

  it("keeps canonical top-level section order", () => {
    const yaml = createConfigBackupYaml({
      ...createSamplePayload(),
      owner: "Node Long",
      ownerShort: "NL",
      location: { lat: 43.7, lon: 10.4 },
    });

    expect(yaml.indexOf("canned_messages:")).toBeLessThan(yaml.indexOf("channel_url:"));
    expect(yaml.indexOf("channel_url:")).toBeLessThan(yaml.indexOf("config:"));
    expect(yaml.indexOf("config:")).toBeLessThan(yaml.indexOf("location:"));
    expect(yaml.indexOf("location:")).toBeLessThan(yaml.indexOf("module_config:"));
    expect(yaml.indexOf("module_config:")).toBeLessThan(yaml.indexOf("owner:"));
    expect(yaml.indexOf("owner:")).toBeLessThan(yaml.indexOf("owner_short:"));
  });

  it("serializes enums as names for cli compatibility", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain("role: CLIENT");
    expect(yaml).toContain("uplink_enabled: true");
  });

  it("uses CLI-compatible base64 encoding for bytes", () => {
    const yaml = createConfigBackupYaml(createSamplePayload());

    expect(yaml).toContain('psk: "base64:AQID"');
    expect(yaml).not.toContain(": undefined");
    expect(yaml).not.toContain("$typeName");
  });

  it("serializes security block exactly like CLI", () => {
    const channels = new Map([
      [
        0,
        create(Protobuf.Channel.ChannelSchema, {
          index: 0,
          role: Protobuf.Channel.Channel_Role.PRIMARY,
          settings: {
            name: "Primary",
          },
        }),
      ],
    ]);

    const config = create(Protobuf.LocalOnly.LocalConfigSchema, {
      security: {
        adminKey: [
          new Uint8Array([
            234, 46, 72, 154, 142, 143, 195, 50, 142, 153, 221, 14, 231, 29,
            161, 123, 115, 168, 215, 39, 133, 86, 66, 244, 115, 58, 190, 77,
            27, 112, 38, 109,
          ]),
        ],
        privateKey: new Uint8Array([
          32, 168, 100, 56, 10, 97, 53, 154, 248, 83, 222, 60, 30, 66, 177, 248,
          157, 61, 132, 174, 193, 28, 32, 5, 190, 244, 21, 32, 44, 1, 144, 71,
        ]),
        publicKey: new Uint8Array([
          175, 179, 184, 165, 39, 28, 32, 193, 151, 9, 73, 66, 36, 82, 84, 127,
          25, 84, 182, 249, 205, 23, 111, 167, 200, 0, 237, 26, 63, 34, 244, 47,
        ]),
        serialEnabled: true,
      },
    });

    const moduleConfig = create(Protobuf.LocalOnly.LocalModuleConfigSchema, {});

    const yaml = createConfigBackupYaml({ channels, config, moduleConfig });

    expect(yaml).toContain("  security:\n    adminKey:\n    - base64:6i5Imo6PwzKOmd0O5x2he3Oo1yeFVkL0czq+TRtwJm0=\n    - 'base64:'\n    - 'base64:'\n    privateKey: base64:IKhkOAphNZr4U948HkKx+J09hK7BHCAFvvQVICwBkEc=\n    publicKey: base64:r7O4pSccIMGXCUlCJFJUfxlUtvnNF2+nyADtGj8i9C8=\n    serialEnabled: true");
    expect(yaml).not.toContain('privateKey: "base64:');
    expect(yaml).not.toContain('publicKey: "base64:');
    expect(yaml).not.toContain("\n      - base64:");
  });

  it("prunes empty sections and avoids {} placeholders", () => {
    const channels = new Map([
      [
        0,
        create(Protobuf.Channel.ChannelSchema, {
          index: 0,
          role: Protobuf.Channel.Channel_Role.PRIMARY,
          settings: {
            name: "Primary",
          },
        }),
      ],
    ]);

    const config = create(Protobuf.LocalOnly.LocalConfigSchema, {});
    const moduleConfig = create(Protobuf.LocalOnly.LocalModuleConfigSchema, {});

    const yaml = createConfigBackupYaml({ channels, config, moduleConfig });

    expect(yaml).not.toContain("{}");
    expect(yaml).not.toContain("module_config:");
  });

  it("escapes owner emojis like meshtastic cli", () => {
    const yaml = createConfigBackupYaml({
      ...createSamplePayload(),
      owner: "Nicco Pisa Berry 🇮🇹",
      ownerShort: "NPB",
      cannedMessages: ["Hi", "Bye"],
    });

    expect(yaml).toContain("canned_messages: Hi|Bye");
    expect(yaml).toContain('owner: "Nicco Pisa Berry \\U0001F1EE\\U0001F1F9"');
    expect(yaml).toContain("owner_short: NPB");
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
      mqtt: {
        enabled: true,
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
  mqtt:
    enabled: true
`);

    expect(parsed.errors).toEqual([]);
    expect(parsed.backup?.config.security.publicKey).toEqual(
      new Uint8Array([
        175, 179, 184, 165, 39, 28, 32, 193, 151, 9, 73, 66, 36, 82, 84, 127,
        25, 84, 182, 249, 205, 23, 111, 167, 200, 0, 237, 26, 63, 34, 244, 47,
      ]),
    );
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
