import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Electron main process (ESM). Owns every filesystem access and native
 * dialog; the renderer never touches Node (charter §4: contextIsolation
 * true, nodeIntegration false, all fs via IPC).
 */

const here = import.meta.dirname;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'GameAsset Forge',
    webPreferences: {
      preload: join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void mainWindow.loadFile(join(here, '..', 'dist-gui', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- dialogs + fs IPC -------------------------------------------------------

ipcMain.handle('dialog:open-png-files', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PNG sprite sheets',
    filters: [{ name: 'PNG images', extensions: ['png'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('dialog:open-preset', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open preset',
    filters: [{ name: 'Preset JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('dialog:save-preset', async (_event, defaultName: string, content: string) => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save preset',
    defaultPath: defaultName,
    filters: [{ name: 'Preset JSON', extensions: ['json'] }],
  });
  if (result.canceled || result.filePath === undefined) return null;
  writeFileSync(result.filePath, content, 'utf8');
  return result.filePath;
});

ipcMain.handle('dialog:choose-output-dir', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output directory',
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

ipcMain.handle('fs:read', (_event, filePath: string) => {
  return new Uint8Array(readFileSync(filePath));
});

ipcMain.handle('fs:write', (_event, filePath: string, bytes: Uint8Array) => {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.from(bytes));
  return filePath;
});

// --- lifecycle ---------------------------------------------------------------

void app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
