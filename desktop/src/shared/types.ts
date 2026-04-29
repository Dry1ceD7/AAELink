/**
 * Types shared between the Electron Main process and the Renderer (Next.js app).
 * Imported by both sides via the preload bridge.
 *
 * Keep this file free of Node.js or browser-only globals so it is safe to
 * import from any context.
 */

// ─── IPC channel names ────────────────────────────────────────────────────────

export const IPC = {
  // Main → Renderer
  NAVIGATE_HOME: "aaelink-navigate-home",
  DEEP_LINK:     "aaelink-deep-link",

  // Renderer → Main (invoke / handle)
  NOTIFY_MESSAGE:    "aaelink-notify-message",
  OPEN_FILE_DIALOG:  "aaelink:open-file-dialog",
  READ_FILE_BYTES:   "aaelink:read-file-bytes",
  SET_BADGE_COUNT:   "aaelink:set-badge-count",
} as const;

// ─── Deep-link ────────────────────────────────────────────────────────────────

export interface DeepLinkPayload {
  url: string; // e.g. aaelink://workspace/abc-123/channel/xyz-456
}

// ─── Navigation ───────────────────────────────────────────────────────────────

export interface NavigateHomePayload {
  workspace_id?:     string;
  focus_message_id?: string;
}

// ─── Native notification ──────────────────────────────────────────────────────

export interface NotifyMessagePayload {
  title?:            string;
  body:              string;
  workspace_id?:     string;
  focus_message_id?: string;
}

// ─── File dialog ──────────────────────────────────────────────────────────────

export interface FileFilter {
  name:       string;
  extensions: string[];
}

export interface OpenFileDialogOptions {
  properties?: Array<"openFile" | "multiSelections" | "openDirectory">;
  filters?:    FileFilter[];
}

export interface OpenFileDialogResult {
  canceled:   boolean;
  filePaths:  string[];
}

export interface ReadFileBytesResult {
  ok:      boolean;
  base64?: string;
  size?:   number;
  error?:  string;
}

// ─── Badge ────────────────────────────────────────────────────────────────────

export interface SetBadgeCountResult {
  ok: boolean;
}

// ─── window.aaelinkDesktop shape (typed for the renderer) ────────────────────

export interface AaelinkDesktopBridge {
  notifyMessage:        (payload: NotifyMessagePayload)    => Promise<{ ok: boolean }>;
  openFileDialog:       (options?: OpenFileDialogOptions)  => Promise<OpenFileDialogResult>;
  readFileBytes:        (filePath: string)                 => Promise<ReadFileBytesResult>;
  setBadgeCount:        (count: number)                    => Promise<SetBadgeCountResult>;
  subscribeNavigateHome:(cb: (p: NavigateHomePayload) => void) => () => void;
  subscribeDeepLink:    (cb: (p: DeepLinkPayload)     => void) => () => void;
}

// Augment the global Window type so renderer TypeScript picks this up.
declare global {
  interface Window {
    aaelinkDesktop?: AaelinkDesktopBridge;
  }
}
