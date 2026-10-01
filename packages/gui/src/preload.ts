import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge. The ONLY channel between the sandboxed renderer and Node.
 * Exposes the narrowest possible typed surface; no raw ipcRenderer leaks.
 */
const api = {
  openPngFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:open-png-files'),
  openPreset: (): Promise<string | null> => ipcRenderer.invoke('dialog:open-preset'),
  savePreset: (defaultName: string, content: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:save-preset', defaultName, content),
  chooseOutputDir: (): Promise<string | null> => ipcRenderer.invoke('dialog:choose-output-dir'),
  readFile: (filePath: string): Promise<Uint8Array> => ipcRenderer.invoke('fs:read', filePath),
  writeFile: (filePath: string, bytes: Uint8Array): Promise<string> =>
    ipcRenderer.invoke('fs:write', filePath, bytes),
};

contextBridge.exposeInMainWorld('forge', api);

export type ForgeBridge = typeof api;
