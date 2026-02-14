import { fromJson, toJson } from "@bufbuild/protobuf";
import {
  channelSetToChannels,
  decodeMeshtasticChannelSetUrl,
} from "@core/utils/channelUrl.ts";
import { Protobuf } from "@meshtastic/core";
import { parse, stringify } from "yaml";

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

export const createConfigBackupYaml = ({
  channels,
  config,
  moduleConfig,
}: {
  channels: Map<number, Protobuf.Channel.Channel>;
  config: Protobuf.LocalOnly.LocalConfig;
  moduleConfig: Protobuf.LocalOnly.LocalModuleConfig;
}) => {
  const configJson = normalizeCliEncodedBytesForExport(
    toBackupJson(Protobuf.LocalOnly.LocalConfigSchema, config),
  ) as SerializableValue;
  const moduleConfigJson = normalizeCliEncodedBytesForExport(
    toBackupJson(Protobuf.LocalOnly.LocalModuleConfigSchema, moduleConfig),
  ) as SerializableValue;

  const channelList = Array.from(channels.values())
    .sort((channelA, channelB) => channelA.index - channelB.index)
    .map(
      (channel) =>
        normalizeCliEncodedBytesForExport(
          sanitizeForExport(
            toJson(Protobuf.Channel.ChannelSchema, channel, {
              enumAsInteger: false,
              useProtoFieldName: false,
              emitDefaultValues: true,
            }) as SerializableValue,
          ),
        ) as SerializableValue,
    );

  const backup = {
    config: configJson,
    module_config: moduleConfigJson,
    channels: channelList,
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

  const hasChannels = cliPayload.channels !== undefined;
  const hasChannelUrl = cliPayload.channel_url !== undefined;

  if (hasChannels && !Array.isArray(cliPayload.channels)) {
    errors.push("invalidChannels");
  } else if (
    Array.isArray(cliPayload.channels) &&
    cliPayload.channels.some(
      (channel) => !isObject(channel) || typeof channel.index !== "number",
    )
  ) {
    errors.push("invalidChannels");
  }

  if (hasChannelUrl && typeof cliPayload.channel_url !== "string") {
    errors.push("invalidFile");
  }

  if (errors.length > 0) {
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
    const channels = Array.isArray(cliPayload.channels)
      ? cliPayload.channels.map((channel) =>
          fromJson(
            Protobuf.Channel.ChannelSchema,
            normalizeCliEncodedValues(stripTypeNames(channel)),
            {
              ignoreUnknownFields: false,
            },
          ),
        )
      : typeof cliPayload.channel_url === "string"
        ? channelSetToChannels(decodeMeshtasticChannelSetUrl(cliPayload.channel_url))
        : [];

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
