import { create, fromBinary } from "@bufbuild/protobuf";
import { Protobuf } from "@meshtastic/core";
import { toByteArray } from "base64-js";

const decodeBase64Url = (value: string): Uint8Array => {
  const paddedString = value
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  return toByteArray(paddedString);
};

export const decodeMeshtasticChannelSetUrl = (
  channelUrl: string,
): Protobuf.AppOnly.ChannelSet => {
  const parsedUrl = new URL(channelUrl);
  const normalizedPath = parsedUrl.pathname.replace(/\/+$/, "");

  if (parsedUrl.hostname !== "meshtastic.org" || normalizedPath !== "/e") {
    throw new Error("invalid channel url");
  }

  if (!parsedUrl.hash) {
    throw new Error("missing channel payload");
  }

  return fromBinary(
    Protobuf.AppOnly.ChannelSetSchema,
    decodeBase64Url(parsedUrl.hash.slice(1)),
  );
};

export const channelSetToChannels = (
  channelSet: Protobuf.AppOnly.ChannelSet,
): Protobuf.Channel.Channel[] => {
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
};
