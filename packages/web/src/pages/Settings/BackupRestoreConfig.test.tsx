import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { BackupRestoreConfig } from "./BackupRestoreConfig.tsx";

const mockSetChange = vi.fn();

vi.mock("@core/stores", () => ({
  useDevice: () => ({
    channels: new Map(),
    config: {},
    moduleConfig: {},
    setChange: mockSetChange,
    connection: undefined,
  }),
  useNodeDB: () => ({
    getMyNode: () => undefined,
  }),
}));

vi.mock("@core/hooks/useToast.ts", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { fileName?: string; count?: number }) => {
      if (key === "backupRestore.selectedFile") {
        return `File selezionato: ${options?.fileName ?? ""}`;
      }
      if (key.startsWith("backupRestore.preview")) {
        return `${key}: ${options?.count ?? 0}`;
      }
      const map: Record<string, string> = {
        "backupRestore.title": "Backup & Ripristino",
        "backupRestore.description": "desc",
        "backupRestore.exportTitle": "Export",
        "backupRestore.exportDescription": "Scarica la configurazione completa in formato compatibile CLI",
        "backupRestore.exportAction": "Scarica backup YAML",
        "backupRestore.restoreTitle": "Restore",
        "backupRestore.restoreDescription": "restore desc",
        "backupRestore.selectFile": "Seleziona file YAML",
        "backupRestore.previewTitle": "Anteprima differenze",
        "backupRestore.applyAction": "Metti in coda il ripristino",
        "backupRestore.errors.invalidFile": "File non valido. Carica un backup YAML valido.",
        "dialog:backupRestoreConfirm.title": "Applicare il ripristino?",
        "dialog:backupRestoreConfirm.description": "desc",
        "dialog:backupRestoreConfirm.cancel": "Annulla",
        "dialog:backupRestoreConfirm.confirm": "Conferma ripristino",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("BackupRestoreConfig", () => {
  beforeEach(() => {
    mockSetChange.mockReset();
  });

  it("downloads backup yaml on export click", () => {
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:backup");
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    render(<BackupRestoreConfig />);

    fireEvent.click(screen.getByRole("button", { name: "Scarica backup YAML" }));

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalled();
    expect(revokeSpy).toHaveBeenCalledWith("blob:backup");
  });

  it("shows validation error for invalid restore file", async () => {
    render(<BackupRestoreConfig />);

    const fileInput = screen.getByLabelText("Seleziona file YAML") as HTMLInputElement;
    const txtFile = new File(["test"], "restore.txt", { type: "text/plain" });

    fireEvent.change(fileInput, { target: { files: [txtFile] } });

    await waitFor(() => {
      expect(
        screen.getByText("File non valido. Carica un backup YAML valido."),
      ).toBeInTheDocument();
    });
  });

  it("keeps apply disabled when file is invalid", async () => {
    render(<BackupRestoreConfig />);

    const fileInput = screen.getByLabelText("Seleziona file YAML") as HTMLInputElement;
    const invalidYaml = new File(["not-valid"], "restore.yaml", {
      type: "application/x-yaml",
    });

    fireEvent.change(fileInput, { target: { files: [invalidYaml] } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Metti in coda il ripristino" })).toBeDisabled();
    });

    expect(mockSetChange).not.toHaveBeenCalled();
  });
});
