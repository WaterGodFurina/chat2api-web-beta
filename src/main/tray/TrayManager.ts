/**
 * TrayManager shim for web-only mode
 * In Electron mode, this manages the system tray icon
 * In web-only mode, this is a no-op
 */
export class TrayManager {
  private static instance: TrayManager

  private constructor() {}

  static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager()
    }
    return TrayManager.instance
  }

  updateProxyStatus(_running: boolean) {
    // No-op in web-only mode
  }

  destroy() {
    // No-op in web-only mode
  }
}
