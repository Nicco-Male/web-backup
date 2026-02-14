import { toJson } from "@bufbuild/protobuf";
import type { Protobuf } from "@meshtastic/core";

type SerializableValue =
  | string
  | number
  | boolean
  | null
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export const CONFIG_BACKUP_FORMAT = "meshtastic-web-config-backup-v1";

export interface ConfigBackupPayload {
  format: string;
  generatedAt?: string;
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

  if (/^-?\d+(\.\d+)?$/.test(source)) {
    return Number(source);
  }

  throw new Error("invalid scalar");
};

const parseYamlSubset = (source: string): unknown => {
  const lines = source
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
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
    generatedAt: new Date().toISOString(),
    format: CONFIG_BACKUP_FORMAT,
    config,
    moduleConfig,
    channels: channelList,
  };

  return `${toYaml(backup)}\n`;
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

  if (parsed.format !== CONFIG_BACKUP_FORMAT) {
    errors.push("unsupportedVersion");
  }

  if (!isObject(parsed.config)) {
    errors.push("missingConfig");
  }

  if (!isObject(parsed.moduleConfig)) {
    errors.push("missingModuleConfig");
  }

  if (!Array.isArray(parsed.channels)) {
    errors.push("missingChannels");
  } else if (
    parsed.channels.some(
      (channel) => !isObject(channel) || typeof channel.index !== "number",
    )
  ) {
    errors.push("invalidChannels");
  }

  if (errors.length > 0) {
    return { errors };
  }

  return {
    errors: [],
    backup: parsed as ConfigBackupPayload,
  };
};
