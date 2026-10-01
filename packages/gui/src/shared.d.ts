/**
 * Shared type for the preload bridge (imported by renderer code for typing
 * only — the implementation is injected by preload.ts at runtime).
 */

export interface ForgeBridge {
  openPngFiles(): Promise<string[]>;
  openPreset(): Promise<string | null>;
  savePreset(defaultName: string, content: string): Promise<string | null>;
  chooseOutputDir(): Promise<string | null>;
  readFile(filePath: string): Promise<Uint8Array>;
  writeFile(filePath: string, bytes: Uint8Array): Promise<string>;
}

declare global {
  interface Window {
    forge: ForgeBridge;
  }
}
