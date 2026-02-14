import { create, fromJson, toBinary, toJson } from "@bufbuild/protobuf";
import { Protobuf } from "@meshtastic/core";
import { fromByteArray } from "base64-js";

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

type SerializableObject = { [key: string]: SerializableValue };

export interface ConfigBackupPayload {
  config: Protobuf.LocalOnly.LocalConfig;
  moduleConfig: Protobuf.LocalOnly.LocalModuleConfig;
  channels: Protobuf.Channel.Channel[];
}

export interface ConfigBackupValidationResult {
  backup?: ConfigBackupPayload;
  errors: string[];
}

const sanitizeForExport = (value: unknown): SerializableValue => {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map) {
    return Object.fromEntries(
      Array.from(value.entries()).map(([key, entryValue]) => [
        String(key),
        sanitizeForExport(entryValue),
      ]),
    );
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForExport(entry));
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "undefined":
    case "function":
    case "symbol":
      return null;
    case "object": {
      const objectValue = value as Record<string, unknown>;
      const sanitizedObject: Record<string, SerializableValue> = {};

      Object.entries(objectValue).forEach(([key, nestedValue]) => {
        if (nestedValue === undefined) {
          return;
        }

        sanitizedObject[key] = sanitizeForExport(nestedValue);
      });

      return sanitizedObject;
    }
    default:
      return null;
  }
};

const quoteScalar = (value: string) => JSON.stringify(value);

const pickInOrder = (
  source: Record<string, unknown>,
  keys: string[],
): SerializableObject => {
  const output: SerializableObject = {};

  keys.forEach((key) => {
    const entryValue = source[key];
    if (entryValue === undefined) {
      return;
    }

    output[key] = sanitizeForExport(entryValue);
  });

  return output;
};

const pruneEmpty = (value: SerializableValue | undefined): SerializableValue | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const pruned = value
      .map((entry) => pruneEmpty(entry))
      .filter((entry): entry is SerializableValue => entry !== undefined);
    return pruned.length > 0 ? pruned : undefined;
  }

  if (typeof value === "object") {
    const output: SerializableObject = {};
    Object.entries(value).forEach(([key, entryValue]) => {
      const prunedEntry = pruneEmpty(entryValue);
      if (prunedEntry === undefined) {
        return;
      }

      if (
        typeof prunedEntry === "object" &&
        !Array.isArray(prunedEntry) &&
        Object.keys(prunedEntry).length === 0
      ) {
        return;
      }

      output[key] = prunedEntry;
    });

    return Object.keys(output).length > 0 ? output : undefined;
  }

  return value;
};

const cliUnicodeEscapes = (value: string): string => {
  let output = "";

  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }

    if (codePoint <= 0x7e) {
      output += char;
    } else if (codePoint <= 0xffff) {
      output += `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
    } else {
      output += `\\U${codePoint.toString(16).toUpperCase().padStart(8, "0")}`;
    }
  }

  return output;
};

const isPlainYamlString = (value: string): boolean => {
  if (!value.length || value !== value.trim()) {
    return false;
  }

  if (value === "true" || value === "false" || value === "null") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return false;
  }

  return !/[:\[\]{}#,]|^[-?!&*%@`|>]/.test(value);
};

const yamlScalar = (value: SerializableValue): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return isPlainYamlString(value) ? value : quoteScalar(value);
  }

  return String(value);
};

const toYaml = (value: SerializableValue, indent = 0): string => {
  const prefix = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }

    return value
      .map((entry) => {
        if (entry !== null && typeof entry === "object") {
          return `${prefix}-\n${toYaml(entry, indent + 2)}`;
        }

        return `${prefix}- ${yamlScalar(entry)}`;
      })
      .join("\n");
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);

    if (entries.length === 0) {
      return "{}";
    }

    return entries
      .map(([key, entryValue]) => {
        if (Array.isArray(entryValue) && entryValue.length === 0) {
          return `${prefix}${key}: []`;
        }

        if (entryValue !== null && typeof entryValue === "object") {
          return `${prefix}${key}:\n${toYaml(entryValue, indent + 2)}`;
        }

        return `${prefix}${key}: ${yamlScalar(entryValue)}`;
      })
      .join("\n");
  }

  return `${prefix}${yamlScalar(value)}`;
};

const parseScalar = (source: string): unknown => {
  if (source === "null") {
    return null;
  }

  if (source === "true") {
    return true;
  }

  if (source === "false") {
    return false;
  }

  if (source.startsWith('"') && source.endsWith('"')) {
    return JSON.parse(source);
  }

  if (source.startsWith("'") && source.endsWith("'")) {
    return source.slice(1, -1).replace(/''/g, "'");
  }

  if (/^-?\d+(\.\d+)?$/.test(source)) {
    return Number(source);
  }

  return source;
};

const parseYamlSubset = (source: string): unknown => {
  const lines = source
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    })
    .map((line) => {
      const trimmed = line.trimStart();
      return {
        indent: line.length - trimmed.length,
        text: trimmed,
      };
    });

  let index = 0;

  const parseAtIndent = (indent: number): unknown => {
    if (index >= lines.length) {
      return null;
    }

    if (lines[index].indent < indent) {
      return null;
    }

    if (lines[index].text.startsWith("-")) {
      const array: unknown[] = [];
      while (index < lines.length && lines[index].indent === indent) {
        const line = lines[index];
        if (!line.text.startsWith("-")) {
          break;
        }

        if (line.text === "-") {
          index += 1;
          array.push(parseAtIndent(indent + 2));
          continue;
        }

        const scalar = line.text.slice(1).trim();
        if (!scalar.length) {
          throw new Error("invalid array entry");
        }

        array.push(parseScalar(scalar));
        index += 1;
      }
      return array;
    }

    const obj: Record<string, unknown> = {};
    while (index < lines.length && lines[index].indent === indent) {
      const line = lines[index];
      if (line.text.startsWith("-")) {
        break;
      }

      const separatorIndex = line.text.indexOf(":");
      if (separatorIndex < 0) {
        throw new Error("invalid object entry");
      }

      const key = line.text.slice(0, separatorIndex).trim();
      const rest = line.text.slice(separatorIndex + 1).trim();
      index += 1;

      if (rest.length === 0) {
        obj[key] = parseAtIndent(indent + 2);
      } else if (rest === "{}") {
        obj[key] = {};
      } else if (rest === "[]") {
        obj[key] = [];
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  };

  return parseAtIndent(0);
};

const CLI_BASE64_KEYS = new Set(["psk", "publicKey", "privateKey", "adminKey"]);

const normalizeCliEncodedBytesForExport = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCliEncodedBytesForExport(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};

  Object.entries(value).forEach(([key, entryValue]) => {
    if (typeof entryValue === "string" && CLI_BASE64_KEYS.has(key)) {
      output[key] = `base64:${entryValue}`;
      return;
    }

    output[key] = normalizeCliEncodedBytesForExport(entryValue);
  });

  return output;
};

const createChannelUrl = ({
  channels,
  loraConfig,
}: {
  channels: Map<number, Protobuf.Channel.Channel>;
  loraConfig?: Protobuf.Config.Config_LoRaConfig;
}) => {
  const channelsToEncode = Array.from(channels.values())
    .sort((a, b) => a.index - b.index)
    .map((channel) => channel.settings)
    .filter((channel): channel is Protobuf.Channel.ChannelSettings => !!channel);

  const encoded = create(Protobuf.AppOnly.ChannelSetSchema, {
    loraConfig,
    settings: channelsToEncode,
  });
  const binary = toBinary(Protobuf.AppOnly.ChannelSetSchema, encoded);

  const base64 = fromByteArray(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `https://meshtastic.org/e/#${base64}`;
};

const toDegrees = (value: number | undefined) => {
  if (value === undefined || value === 0) {
    return undefined;
  }

  return value / 1e7;
};

export const createConfigBackupYaml = ({
  channels,
  config,
  moduleConfig,
  owner,
  ownerShort,
  location,
  cannedMessages,
}: {
  channels: Map<number, Protobuf.Channel.Channel>;
  config: Protobuf.LocalOnly.LocalConfig;
  moduleConfig: Protobuf.LocalOnly.LocalModuleConfig;
  owner?: string;
  ownerShort?: string;
  location?: { lat?: number; lon?: number };
  cannedMessages?: string[];
}) => {
  const configJson = normalizeCliEncodedBytesForExport(
    toBackupJson(Protobuf.LocalOnly.LocalConfigSchema, config),
  ) as Record<string, unknown>;
  const moduleConfigJson = normalizeCliEncodedBytesForExport(
    toBackupJson(Protobuf.LocalOnly.LocalModuleConfigSchema, moduleConfig),
  ) as Record<string, unknown>;

  const orderedConfig = {
    bluetooth: pickInOrder(isObject(configJson.bluetooth) ? configJson.bluetooth : {}, [
      "enabled",
      "fixedPin",
      "mode",
    ]),
    device: pickInOrder(isObject(configJson.device) ? configJson.device : {}, [
      "disableTripleClick",
      "nodeInfoBroadcastSecs",
      "role",
      "tzdef",
    ]),
    display: pickInOrder(isObject(configJson.display) ? configJson.display : {}, ["screenOnSecs"]),
    lora: pickInOrder(isObject(configJson.lora) ? configJson.lora : {}, [
      "bandwidth",
      "codingRate",
      "hopLimit",
      "ignoreMqtt",
      "modemPreset",
      "region",
      "spreadFactor",
      "sx126xRxBoostedGain",
      "txEnabled",
      "txPower",
      "usePreset",
    ]),
    network: pickInOrder(isObject(configJson.network) ? configJson.network : {}, [
      "enabledProtocols",
      "ntpServer",
    ]),
    position: pickInOrder(isObject(configJson.position) ? configJson.position : {}, [
      "broadcastSmartMinimumDistance",
      "broadcastSmartMinimumIntervalSecs",
      "fixedPosition",
      "gpsUpdateInterval",
      "positionBroadcastSecs",
      "positionBroadcastSmartEnabled",
      "positionFlags",
    ]),
    power: pickInOrder(isObject(configJson.power) ? configJson.power : {}, [
      "lsSecs",
      "minWakeSecs",
      "sdsSecs",
      "waitBluetoothSecs",
    ]),
    security: pickInOrder(isObject(configJson.security) ? configJson.security : {}, [
      "adminKey",
      "privateKey",
      "publicKey",
      "serialEnabled",
    ]),
  };

  const mqttConfig = isObject(moduleConfigJson.mqtt) ? moduleConfigJson.mqtt : {};
  const orderedModuleConfig = {
    ambientLighting: pickInOrder(
      isObject(moduleConfigJson.ambientLighting) ? moduleConfigJson.ambientLighting : {},
      ["blue", "current", "green", "red"],
    ),
    cannedMessage: pickInOrder(
      isObject(moduleConfigJson.cannedMessage) ? moduleConfigJson.cannedMessage : {},
      ["enabled"],
    ),
    detectionSensor: pickInOrder(
      isObject(moduleConfigJson.detectionSensor) ? moduleConfigJson.detectionSensor : {},
      ["detectionTriggerType", "minimumBroadcastSecs"],
    ),
    mqtt: {
      ...pickInOrder(mqttConfig, [
        "address",
        "enabled",
        "encryptionEnabled",
        "jsonEnabled",
        "mapReportSettings",
        "mapReportingEnabled",
        "password",
        "root",
        "username",
      ]),
      mapReportSettings: pickInOrder(
        isObject(mqttConfig.mapReportSettings) ? mqttConfig.mapReportSettings : {},
        ["positionPrecision", "publishIntervalSecs"],
      ),
    },
    neighborInfo: pickInOrder(
      isObject(moduleConfigJson.neighborInfo) ? moduleConfigJson.neighborInfo : {},
      ["updateInterval"],
    ),
    storeForward: pickInOrder(
      isObject(moduleConfigJson.storeForward) ? moduleConfigJson.storeForward : {},
      [
        "enabled",
        "heartbeat",
        "historyReturnMax",
        "historyReturnWindow",
        "isServer",
        "records",
      ],
    ),
  };

  const backup = pruneEmpty({
    canned_messages: (cannedMessages ?? []).join("|"),
    channel_url: createChannelUrl({ channels, loraConfig: config.lora }),
    config: orderedConfig,
    location:
      location?.lat !== undefined && location?.lon !== undefined
        ? { lat: location.lat, lon: location.lon }
        : undefined,
    module_config: orderedModuleConfig,
    owner,
    owner_short: ownerShort,
  });

  let yaml = `# start of Meshtastic configure yaml
${toYaml(backup ?? {})}
`;

  if (owner) {
    yaml = yaml.replace(/^owner:.*$/m, `owner: "${cliUnicodeEscapes(owner)}"`);
  }

  yaml = yaml.replace(/^canned_messages: "(.*)"$/m, "canned_messages: $1");
  yaml = yaml.replace(/^channel_url: "(https:\/\/.*)"$/m, "channel_url: $1");

  return yaml;
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

export const parseConfigBackupYaml = (
  source: string,
): ConfigBackupValidationResult => {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = parseYamlSubset(source);
  } catch {
    return { errors: ["invalidFile"] };
  }

  if (!isObject(parsed)) {
    return { errors: ["invalidFile"] };
  }

  if (!isObject(parsed.config)) {
    errors.push("missingConfig");
  }

  const rawModuleConfig = isObject(parsed.moduleConfig)
    ? parsed.moduleConfig
    : parsed.module_config;

  if (!isObject(rawModuleConfig)) {
    errors.push("missingModuleConfig");
  }

  if (
    parsed.channels !== undefined &&
    !Array.isArray(parsed.channels)
  ) {
    errors.push("invalidChannels");
  } else if (
    Array.isArray(parsed.channels) &&
    parsed.channels.some(
      (channel) => !isObject(channel) || typeof channel.index !== "number",
    )
  ) {
    errors.push("invalidChannels");
  }

  if (errors.length > 0) {
    return { errors };
  }

  try {
    const config = fromJson(
      Protobuf.LocalOnly.LocalConfigSchema,
      normalizeCliEncodedValues(stripTypeNames(parsed.config)),
      { ignoreUnknownFields: false },
    );
    const moduleConfig = fromJson(
      Protobuf.LocalOnly.LocalModuleConfigSchema,
      normalizeCliEncodedValues(stripTypeNames(rawModuleConfig)),
      { ignoreUnknownFields: false },
    );
    const channels = (Array.isArray(parsed.channels) ? parsed.channels : []).map((channel) =>
      fromJson(
        Protobuf.Channel.ChannelSchema,
        normalizeCliEncodedValues(stripTypeNames(channel)),
        {
          ignoreUnknownFields: false,
        },
      ),
    );

    return {
      errors: [],
      backup: {
        config,
        moduleConfig,
        channels,
      },
    };
  } catch {
    return { errors: ["invalidFile"] };
  }
};

const stripTypeNames = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => stripTypeNames(entry));
  }

  if (!isObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    if (key === "$typeName") {
      return;
    }

    output[key] = stripTypeNames(entryValue);
  });
  return output;
};

const normalizeCliEncodedValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCliEncodedValues(entry));
  }

  if (typeof value === "string" && value.startsWith("base64:")) {
    return value.slice("base64:".length);
  }

  if (!isObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  Object.entries(value).forEach(([key, entryValue]) => {
    output[key] = normalizeCliEncodedValues(entryValue);
  });

  return output;
};

const toBackupJson = <T>(schema: Parameters<typeof toJson>[0], message: T) => {
  return sanitizeForExport(
    toJson(schema, message, {
      useProtoFieldName: false,
      emitDefaultValues: true,
      enumAsInteger: false,
    }) as unknown,
  );
};

export const getLocationFromNode = (
  node?: Protobuf.Mesh.NodeInfo,
): { lat?: number; lon?: number } | undefined => {
  if (!node?.position) {
    return undefined;
  }

  const lat = toDegrees(node.position.latitudeI);
  const lon = toDegrees(node.position.longitudeI);

  if (lat === undefined || lon === undefined) {
    return undefined;
  }

  return { lat, lon };
};
