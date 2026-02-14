import { create, fromBinary, fromJson, toJson } from "@bufbuild/protobuf";
import { createChannelShareUrl } from "@core/utils/channelUrl.ts";
import { Protobuf, type Types } from "@meshtastic/core";
import { toByteArray } from "base64-js";

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export interface ConfigBackupPayload {
  config: Protobuf.LocalOnly.LocalConfig;
  moduleConfig: Protobuf.LocalOnly.LocalModuleConfig;
  channels: Protobuf.Channel.Channel[];
}

// Restore payload normalized for the app runtime.
// Minimum accepted CLI restore input is: config + module_config (or moduleConfig).
// Channels can be provided either as `channels[]` or `channel_url`.
export type ConfigBackupRestorePayload = ConfigBackupPayload;

interface ConfigBackupCliPayload extends Record<string, unknown> {
  config?: unknown;
  moduleConfig?: unknown;
  module_config?: unknown;
  channels?: unknown;
  channel_url?: unknown;
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


const decodeChannelsFromChannelUrl = (
  channelUrl: string,
): Protobuf.Channel.Channel[] | null => {
  try {
    const channelsUrl = new URL(channelUrl);
    if (
      channelsUrl.hostname !== "meshtastic.org" ||
      channelsUrl.pathname !== "/e/" ||
      !channelsUrl.hash
    ) {
      return null;
    }

    const encodedChannelConfig = channelsUrl.hash.substring(1);
    const paddedString = encodedChannelConfig
      .padEnd(
        encodedChannelConfig.length +
          ((4 - (encodedChannelConfig.length % 4)) % 4),
        "=",
      )
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const channelSet = fromBinary(
      Protobuf.AppOnly.ChannelSetSchema,
      toByteArray(paddedString),
    );

    return channelSet.settings.map((settings, index) =>
      create(Protobuf.Channel.ChannelSchema, {
        index,
        role:
          index === 0
            ? Protobuf.Channel.Channel_Role.PRIMARY
            : Protobuf.Channel.Channel_Role.SECONDARY,
        settings,
      }),
    );
  } catch {
    return null;
  }
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

const INT_DEG = 1e7;

const toCoordinate = (value?: number) => {
  if (typeof value !== "number") {
    return 0;
  }

  return Math.abs(value) > 180 ? value / INT_DEG : value;
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
  location?: { latitudeI?: number; longitudeI?: number };
  cannedMessages?: string | string[];
}) => {
  const configJson = normalizeCliEncodedBytesForExport(
    toBackupJson(Protobuf.LocalOnly.LocalConfigSchema, config),
  ) as SerializableValue;
  const moduleConfigJson = normalizeCliEncodedBytesForExport(
    toBackupJson(Protobuf.LocalOnly.LocalModuleConfigSchema, moduleConfig),
  ) as SerializableValue;

  const cannedMessagesValue = Array.isArray(cannedMessages)
    ? cannedMessages.join("|")
    : (cannedMessages ?? "");

  const backup = {
    canned_messages: cannedMessagesValue,
    channel_url: createChannelShareUrl({
      channels: channels as Map<Types.ChannelNumber, Protobuf.Channel.Channel>,
      loraConfig: config.lora,
    }),
    config: configJson,
    location: {
      lat: toCoordinate(location?.latitudeI),
      lon: toCoordinate(location?.longitudeI),
    },
    module_config: moduleConfigJson,
    owner: owner ?? "",
    owner_short: ownerShort ?? "",
  };

  return `# start of Meshtastic configure yaml\n${stringify(backup, {
    indent: 2,
  })}`;
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
    parsed = parse(source);
  } catch {
    return { errors: ["invalidFile"] };
  }

  if (!isObject(parsed)) {
    return { errors: ["invalidFile"] };
  }

  const cliPayload = parsed as ConfigBackupCliPayload;

  if (!isObject(cliPayload.config)) {
    errors.push("missingConfig");
  }

  const rawModuleConfig = isObject(cliPayload.moduleConfig)
    ? cliPayload.moduleConfig
    : cliPayload.module_config;

  if (!isObject(rawModuleConfig)) {
    errors.push("missingModuleConfig");
  }

  const decodedChannels =
    typeof parsed.channel_url === "string"
      ? decodeChannelsFromChannelUrl(parsed.channel_url)
      : null;

  const rawChannels = Array.isArray(parsed.channels)
    ? parsed.channels
    : decodedChannels;

  if (!Array.isArray(rawChannels)) {
    errors.push("missingChannels");
  } else if (
    rawChannels.some(
      (channel) => !isObject(channel) || typeof channel.index !== "number",
    )
  ) {
    errors.push("invalidChannels");
  }

  if (errors.length > 0 || !Array.isArray(rawChannels)) {
    return { errors };
  }

  try {
    const config = fromJson(
      Protobuf.LocalOnly.LocalConfigSchema,
      normalizeCliEncodedValues(stripTypeNames(cliPayload.config)),
      { ignoreUnknownFields: false },
    );
    const moduleConfig = fromJson(
      Protobuf.LocalOnly.LocalModuleConfigSchema,
      normalizeCliEncodedValues(stripTypeNames(rawModuleConfig)),
      { ignoreUnknownFields: false },
    );
    const channels = rawChannels.map((channel) =>
      fromJson(Protobuf.Channel.ChannelSchema, normalizeCliEncodedValues(stripTypeNames(channel)), {
        ignoreUnknownFields: false,
      }),
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
