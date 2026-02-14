import { create, toBinary } from "@bufbuild/protobuf";
import { Protobuf, type Types } from "@meshtastic/core";
import { fromByteArray } from "base64-js";

export const createChannelShareUrl = ({
  channels,
  loraConfig,
  addChannels = false,
  selectedChannelIndexes,
}: {
  channels: Map<Types.ChannelNumber, Protobuf.Channel.Channel>;
  loraConfig?: Protobuf.Config.Config_LoRaConfig;
  addChannels?: boolean;
  selectedChannelIndexes?: number[];
}) => {
  const selected = selectedChannelIndexes
    ? new Set(selectedChannelIndexes)
    : undefined;

  const channelsToEncode = Array.from(channels.values())
    .filter((channel) => (selected ? selected.has(channel.index) : true))
    .map((channel) => channel.settings)
    .filter((channel): channel is Protobuf.Channel.ChannelSettings => !!channel);

  const encoded = create(Protobuf.AppOnly.ChannelSetSchema, {
    loraConfig,
    settings: channelsToEncode,
  });

  const base64 = fromByteArray(toBinary(Protobuf.AppOnly.ChannelSetSchema, encoded))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `https://meshtastic.org/e/${addChannels ? "?add=true" : ""}#${base64}`;
};

