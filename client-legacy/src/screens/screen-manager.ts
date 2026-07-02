export interface Screen {
  enter(): void;
  exit(): void;
  suspend?(): void;
  resume?(): void;
}

export type ScreenName = string;

export class ScreenManager {
  private screens = new Map<ScreenName, Screen>();
  private overlays = new Set<ScreenName>();
  private base: ScreenName | null = null;
  private overlay: ScreenName | null = null;

  register(name: ScreenName, screen: Screen, overlay = false) {
    this.screens.set(name, screen);
    if (overlay) this.overlays.add(name);
  }

  switchTo(name: ScreenName) {
    if (this.overlays.has(name)) {
      if (this.overlay === name) return;
      if (this.overlay) {
        this.screens.get(this.overlay)!.exit();
      } else if (this.base) {
        this.screens.get(this.base)!.suspend?.();
      }
      this.overlay = name;
      this.screens.get(name)!.enter();
    } else {
      if (this.overlay) {
        this.screens.get(this.overlay)!.exit();
        this.overlay = null;
      }
      if (this.base !== name) {
        if (this.base) {
          this.screens.get(this.base)!.exit();
        }
        this.base = name;
        this.screens.get(name)!.enter();
      } else if (this.base) {
        this.screens.get(this.base)!.resume?.();
      }
    }
  }

  getActive(): ScreenName | null {
    return this.overlay ?? this.base;
  }

  isActive(name: ScreenName): boolean {
    return (this.overlay ?? this.base) === name;
  }
}
