import { create, toBinary } from "@bufbuild/protobuf";
import type { MeshDevice } from "@meshtastic/core";
import { Protobuf } from "@meshtastic/core";

const DEFAULT_TIMEOUT_MS = 3000;

export const fetchCannedMessages = async (
  connection: MeshDevice | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string> => {
  if (!connection) {
    return "";
  }

  return new Promise((resolve) => {
    let resolved = false;

    const finish = (value: string) => {
      if (resolved) {
        return;
      }

      resolved = true;
      clearTimeout(timeoutId);
      connection.events.onCannedMessageModulePacket.unsubscribe(handleResponse);
      resolve(value);
    };

    const handleResponse = ({ data }: { data: string }) => {
      finish(data ?? "");
    };

    const timeoutId = globalThis.setTimeout(() => {
      finish("");
    }, timeoutMs);

    connection.events.onCannedMessageModulePacket.subscribe(handleResponse);

    const request = create(Protobuf.Admin.AdminMessageSchema, {
      payloadVariant: {
        case: "getCannedMessageModuleMessagesRequest",
        value: true,
      },
    });

    void connection
      .sendPacket(
        toBinary(Protobuf.Admin.AdminMessageSchema, request),
        Protobuf.Portnums.PortNum.ADMIN_APP,
        "self",
      )
      .catch(() => {
        finish("");
      });
  });
};
