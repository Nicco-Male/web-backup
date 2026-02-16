import { create } from "@bufbuild/protobuf";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@components/UI/AlertDialog.tsx";
import { Button } from "@components/UI/Button.tsx";
import { useToast } from "@core/hooks/useToast.ts";
import { useDevice, useNodeDB } from "@core/stores";
import { fetchCannedMessages } from "@core/utils/cannedMessages.ts";
import {
  createConfigBackupFileName,
  createConfigBackupYaml,
  getLocationFromNode,
  parseConfigBackupYaml,
  type ConfigBackupPayload,
} from "@core/utils/configBackup.ts";
import { Protobuf } from "@meshtastic/core";
import { DownloadIcon, UploadIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const CONFIG_VARIANTS = [
  "device",
  "position",
  "power",
  "network",
  "display",
  "lora",
  "bluetooth",
  "security",
] as const;

const MODULE_CONFIG_VARIANTS = [
  "mqtt",
  "serial",
  "externalNotification",
  "storeForward",
  "rangeTest",
  "telemetry",
  "cannedMessage",
  "audio",
  "neighborInfo",
  "ambientLighting",
  "detectionSensor",
  "paxcounter",
] as const;

const isDifferent = (left: unknown, right: unknown): boolean => {
  return JSON.stringify(left) !== JSON.stringify(right);
};

export const BackupRestoreConfig = () => {
  const { channels, config, moduleConfig, setChange, connection } = useDevice();
  const { getMyNode } = useNodeDB();
  const { toast } = useToast();
  const { t } = useTranslation(["config", "dialog"]);

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [backupPreview, setBackupPreview] = useState<ConfigBackupPayload | null>(
    null,
  );

  const downloadConfigBackup = async () => {
    const myNode = getMyNode();
    const cannedMessages = await fetchCannedMessages(connection);
    const backupYaml = createConfigBackupYaml({
      channels,
      config,
      moduleConfig,
      owner: myNode?.user?.longName,
      ownerShort: myNode?.user?.shortName,
      location: getLocationFromNode(myNode),
      cannedMessages,
    });

    const fileName = createConfigBackupFileName({
      ownerLongName: myNode?.user?.longName,
    });

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
  };

  const diffSummary = useMemo(() => {
    if (!backupPreview) {
      return {
        configDiffs: 0,
        moduleDiffs: 0,
        channelDiffs: 0,
        ownerDiff: false,
        cannedMessagesDiff: false,
      };
    }

    const configDiffs = CONFIG_VARIANTS.filter((variant) =>
      isDifferent(config[variant], backupPreview.config[variant]),
    ).length;

    const moduleDiffs = MODULE_CONFIG_VARIANTS.filter((variant) =>
      isDifferent(moduleConfig[variant], backupPreview.moduleConfig[variant]),
    ).length;

    const existingChannels = new Map(Array.from(channels.entries()));
    const previewChannels = new Map(
      backupPreview.channels.map((channel) => [channel.index, channel]),
    );

    const allIndexes = new Set([
      ...existingChannels.keys(),
      ...previewChannels.keys(),
    ]);

    const channelDiffs = Array.from(allIndexes).filter((index) =>
      isDifferent(existingChannels.get(index), previewChannels.get(index)),
    ).length;

    const currentUser = getMyNode()?.user;
    const ownerLong = backupPreview.owner?.trim();
    const ownerShort = backupPreview.ownerShort?.trim();
    const ownerDiff =
      !!(
        (ownerLong && ownerLong !== currentUser?.longName) ||
        (ownerShort && ownerShort !== currentUser?.shortName)
      );

    const cannedMessagesDiff = backupPreview.cannedMessages !== undefined;

    return {
      configDiffs,
      moduleDiffs,
      channelDiffs,
      ownerDiff,
      cannedMessagesDiff,
    };
  }, [backupPreview, channels, config, moduleConfig, getMyNode]);

  const hasValidPreview = validationErrors.length === 0 && backupPreview !== null;
  const hasChangesToApply =
    hasValidPreview &&
    (diffSummary.configDiffs > 0 ||
      diffSummary.moduleDiffs > 0 ||
      diffSummary.channelDiffs > 0 ||
      diffSummary.ownerDiff ||
      diffSummary.cannedMessagesDiff);

  const onFileSelected = async (file?: File | null) => {
    if (!file) {
      setSelectedFileName(null);
      setValidationErrors([]);
      setBackupPreview(null);
      return;
    }

    const normalizedFileName = file.name.toLowerCase();
    if (
      !normalizedFileName.endsWith(".yaml") &&
      !normalizedFileName.endsWith(".yml")
    ) {
      setValidationErrors(["invalidFile"]);
      setBackupPreview(null);
      setSelectedFileName(file.name);
      return;
    }

    const content = await file.text();
    const validationResult = parseConfigBackupYaml(content);

    setSelectedFileName(file.name);
    setValidationErrors(validationResult.errors);

    if (validationResult.errors.length > 0 || !validationResult.backup) {
      setBackupPreview(null);
      return;
    }

    setBackupPreview(validationResult.backup);
  };

  const applyRestore = () => {
    if (!backupPreview || validationErrors.length > 0) {
      return;
    }

    const ownerLong = backupPreview.owner?.trim();
    const ownerShort = backupPreview.ownerShort?.trim();
    if (ownerLong || ownerShort) {
      const currentUser = getMyNode()?.user;
      const nextLong = ownerLong ?? currentUser?.longName;
      const nextShort = ownerShort ?? currentUser?.shortName;

      if (
        nextLong &&
        nextShort &&
        (nextLong !== currentUser?.longName || nextShort !== currentUser?.shortName)
      ) {
        setChange(
          { type: "user" },
          create(Protobuf.Mesh.UserSchema, {
            id: currentUser?.id ?? "",
            longName: nextLong,
            shortName: nextShort,
            isLicensed: currentUser?.isLicensed ?? false,
            isUnmessageable: currentUser?.isUnmessageable ?? false,
            role: currentUser?.role,
            publicKey: currentUser?.publicKey,
            hwModel: currentUser?.hwModel,
          }),
        );
      }
    }

    CONFIG_VARIANTS.forEach((variant) => {
      const backupValue = backupPreview.config[variant];
      if (!isDifferent(config[variant], backupValue)) {
        return;
      }
      setChange({ type: "config", variant }, backupValue);
    });

    MODULE_CONFIG_VARIANTS.forEach((variant) => {
      const backupValue = backupPreview.moduleConfig[variant];
      if (!isDifferent(moduleConfig[variant], backupValue)) {
        return;
      }
      setChange({ type: "moduleConfig", variant }, backupValue);
    });

    const previewChannels = new Map(
      backupPreview.channels.map((channel) => [channel.index, channel]),
    );

    const allIndexes = new Set([...channels.keys(), ...previewChannels.keys()]);
    Array.from(allIndexes).forEach((index) => {
      const currentChannel = channels.get(index);
      const backupChannel = previewChannels.get(index);
      if (!backupChannel || !isDifferent(currentChannel, backupChannel)) {
        return;
      }
      setChange({ type: "channel", index }, backupChannel);
    });

    if (backupPreview.cannedMessages !== undefined) {
      const cannedMessagesMessage = create(Protobuf.Admin.AdminMessageSchema, {
        payloadVariant: {
          case: "setCannedMessageModuleMessages",
          value: backupPreview.cannedMessages,
        },
      });

      setChange(
        {
          type: "adminMessage",
          variant: "other",
          id: "restore-canned-messages",
        },
        cannedMessagesMessage,
      );
    }

    toast({
      title: t("backupRestore.toastQueued.title"),
      description: t("backupRestore.toastQueued.description"),
    });
  };

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div>
        <h2 className="text-lg font-semibold">{t("backupRestore.title")}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-300">
          {t("backupRestore.description")}
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm font-medium">{t("backupRestore.exportTitle")}</p>
        <p className="text-sm text-slate-500 dark:text-slate-300">
          {t("backupRestore.exportDescription")}
        </p>
        <Button onClick={downloadConfigBackup}>
          <DownloadIcon className="mr-2" size={16} />
          {t("backupRestore.exportAction")}
        </Button>
      </div>

      <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-sm font-medium">{t("backupRestore.restoreTitle")}</p>
        <p className="text-sm text-slate-500 dark:text-slate-300">
          {t("backupRestore.restoreDescription")}
        </p>

        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <UploadIcon size={16} />
          {t("backupRestore.selectFile")}
          <input
            className="hidden"
            type="file"
            accept=".yaml,.yml,application/x-yaml,text/yaml"
            onChange={(event) => onFileSelected(event.target.files?.[0])}
          />
        </label>

        {selectedFileName && (
          <p className="text-xs text-slate-500 dark:text-slate-300">
            {t("backupRestore.selectedFile", { fileName: selectedFileName })}
          </p>
        )}

        {validationErrors.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-red-600">
            {validationErrors.map((error) => (
              <li key={error}>{t(`backupRestore.errors.${error}`)}</li>
            ))}
          </ul>
        )}

        {hasValidPreview && (
          <div className="space-y-1 text-sm">
            <p className="font-medium">{t("backupRestore.previewTitle")}</p>
            <p>
              {t("backupRestore.previewConfig", { count: diffSummary.configDiffs })}
            </p>
            <p>
              {t("backupRestore.previewModule", { count: diffSummary.moduleDiffs })}
            </p>
            <p>
              {t("backupRestore.previewChannels", {
                count: diffSummary.channelDiffs,
              })}
            </p>
          </div>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={!hasChangesToApply}>
              {t("backupRestore.applyAction")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("backupRestoreConfirm.title", { ns: "dialog" })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("backupRestoreConfirm.description", { ns: "dialog" })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("backupRestoreConfirm.cancel", { ns: "dialog" })}
              </AlertDialogCancel>
              <AlertDialogAction onClick={applyRestore}>
                {t("backupRestoreConfirm.confirm", { ns: "dialog" })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
};
