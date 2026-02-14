import { toJson } from "@bufbuild/protobuf";
import type { Protobuf } from "@meshtastic/core";

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

const isSerializableObject = (
  value: SerializableValue,
): value is { [key: string]: SerializableValue } =>
  value !== null && !Array.isArray(value) && typeof value === "object";

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

const yamlScalar = (value: SerializableValue): string => {
  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return quoteScalar(value);
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

const toCliJson = <TMessage>(schema: TMessage, message: unknown): SerializableValue =>
  sanitizeForExport(
    toJson(schema, message as never, {
      enumAsInteger: false,
      useProtoFieldName: true,
      emitDefaultValues: false,
    }),
  );

const pruneEmptyObjects = (value: SerializableValue): SerializableValue => {
  if (Array.isArray(value)) {
    return value.map((entry) => pruneEmptyObjects(entry));
  }

  if (!isSerializableObject(value)) {
    return value;
  }

  const prunedEntries = Object.entries(value).flatMap(([key, entryValue]) => {
    const prunedValue = pruneEmptyObjects(entryValue);

    if (isSerializableObject(prunedValue) && Object.keys(prunedValue).length === 0) {
      return [];
    }

    return [[key, prunedValue] as const];
  });

  return Object.fromEntries(prunedEntries);
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
  const channelList = Array.from(channels.values())
    .sort((channelA, channelB) => channelA.index - channelB.index)
    .map((channel) => toCliJson(Protobuf.Channel.ChannelSchema, channel));

  const backup = {
    config: toCliJson(Protobuf.LocalOnly.LocalConfigSchema, config),
    module_config: pruneEmptyObjects(
      toCliJson(Protobuf.LocalOnly.LocalModuleConfigSchema, moduleConfig),
    ),
    channels: channelList,
  };

  return `${toYaml(backup)}\n`;
};
