export interface Screen {
  enter(): void;
  exit(): void;
}

export type ScreenName = string;

export class ScreenManager {
  private screens = new Map<ScreenName, Screen>();
  private active: ScreenName | null = null;

  register(name: ScreenName, screen: Screen) {
    this.screens.set(name, screen);
  }

  switchTo(name: ScreenName) {
    if (this.active === name) return;

    if (this.active) {
      this.screens.get(this.active)!.exit();
    }

    this.active = name;
    this.screens.get(name)!.enter();
  }

  getActive(): ScreenName | null {
    return this.active;
  }

  isActive(name: ScreenName): boolean {
    return this.active === name;
  }
}
