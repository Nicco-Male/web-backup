import { Channel } from "@app/components/PageComponents/Channels/Channel";
import { Button } from "@components/UI/Button.tsx";
import { Spinner } from "@components/UI/Spinner.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@components/UI/Tabs.tsx";
import { useDevice, useNodeDB } from "@core/stores";
import {
  createConfigBackupYaml,
  getLocationFromNode,
} from "@core/utils/configBackup.ts";
import type { Protobuf } from "@meshtastic/core";
import i18next from "i18next";
import { DownloadIcon, QrCodeIcon, UploadIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@components/UI/Tooltip.tsx";
import { Suspense, useCallback, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";

interface ConfigProps {
  onFormInit: <T extends object>(methods: UseFormReturn<T>) => void;
}

export const getChannelName = (channel: Protobuf.Channel.Channel) => {
  return channel.settings?.name.length
    ? channel.settings?.name
    : channel.index === 0
      ? i18next.t("page.broadcastLabel")
      : i18next.t("page.channelIndex", {
          ns: "channels",
          index: channel.index,
        });
};

export const Channels = ({ onFormInit }: ConfigProps) => {
  const { channels, config, moduleConfig, hasChannelChange, setDialogOpen } =
    useDevice();
  const { getMyNode } = useNodeDB();
  const { t } = useTranslation("channels");

  const allChannels = Array.from(channels.values());

  const downloadConfigBackup = useCallback(() => {
    const myNode = getMyNode();
    const backupYaml = createConfigBackupYaml({
      channels,
      config,
      moduleConfig,
      owner: myNode?.user?.longName,
      ownerShort: myNode?.user?.shortName,
      location: getLocationFromNode(myNode),
    });

    const now = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `meshtastic_config_backup_${now}.yaml`;

    const blob = new Blob([backupYaml], { type: "application/x-yaml" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }, [channels, config, moduleConfig, getMyNode]);

  const flags = useMemo(
    () =>
      new Map(
        allChannels.map((channel) => [
          channel.index,
          hasChannelChange(channel.index),
        ]),
      ),
    [allChannels, hasChannelChange],
  );

  return (
    <Tabs defaultValue="channel_0">
      <TabsList className="w-full dark:bg-slate-700">
        {allChannels.map((channel) => (
          <TabsTrigger
            key={`channel_${channel.index}`}
            value={`channel_${channel.index}`}
            className="dark:text-white relative"
          >
            {getChannelName(channel)}
            {flags.get(channel.index) && (
              <span className="absolute -top-0.5 -right-0.5 z-50 flex size-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-500 opacity-25" />
                <span className="relative inline-flex size-3 rounded-full bg-sky-500" />
              </span>
            )}
          </TabsTrigger>
        ))}
        <Button
          className="ml-auto mr-1 h-8"
          onClick={() => setDialogOpen("import", true)}
        >
          <UploadIcon className="mr-2" size={14} />
          {t("page.import")}
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className=" h-8" onClick={() => setDialogOpen("QR", true)}>
                <QrCodeIcon className="mr-2" size={14} />
                {t("page.exportCli")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("page.exportCliDescription")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button className="h-8" onClick={downloadConfigBackup}>
                <DownloadIcon className="mr-2" size={14} />
                {t("page.exportWeb")}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("page.exportWebDescription")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="text-xs text-muted-foreground pl-2">
          {t("page.backupCompatibilityLabel")}
        </span>
      </TabsList>
      {allChannels.map((channel) => (
        <TabsContent
          key={`channel_${channel.index}`}
          value={`channel_${channel.index}`}
        >
          <Suspense fallback={<Spinner size="lg" className="my-5" />}>
            <Channel
              key={channel.index}
              onFormInit={onFormInit}
              channel={channel}
            />
          </Suspense>
        </TabsContent>
      ))}
    </Tabs>
  );
};
