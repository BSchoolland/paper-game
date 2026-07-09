import { Container, Sprite } from "pixi.js";
import { transformAttachment, type ItemDefinition, type AttachmentData, type AnimSet, type CharacterAnchors, type AnchorSet } from "shared";
import type { AnimState } from "./sprite-assets.js";
import { getPlayerTexture } from "./sprite-assets.js";
import { loadItemTexture } from "./item-sprites.js";
import { loadCharacterAnchors } from "./anchor-loader.js";

export class CharacterSprite {
  readonly container: Container;
  readonly sprites: Record<string, Sprite> = {};
  private animSet: AnimSet;
  private animState: AnimState;
  private facingLeft: boolean;
  readonly scale: number;
  private itemSprites: Sprite[] = [];
  private equipped: readonly ItemDefinition[] = [];
  private attachments: Record<string, AttachmentData> = {};
  private characterAnchors: CharacterAnchors | null = null;

  constructor(
    animSet: AnimSet,
    states: readonly AnimState[],
    targetHeight: number,
    facingLeft = false,
  ) {
    this.animSet = animSet;
    this.animState = states[0]!;
    this.facingLeft = facingLeft;
    this.container = new Container();

    const idleTex = getPlayerTexture(animSet, "idle");
    this.scale = targetHeight / idleTex.height;

    for (const state of states) {
      const tex = getPlayerTexture(animSet, state);
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5, 0.75);
      sprite.scale.set(facingLeft ? -this.scale : this.scale, this.scale);
      sprite.visible = state === this.animState;
      this.container.addChild(sprite);
      this.sprites[state] = sprite;
    }
  }

  get currentAnimState(): AnimState {
    return this.animState;
  }

  get currentAnimSet(): AnimSet {
    return this.animSet;
  }

  get isFacingLeft(): boolean {
    return this.facingLeft;
  }

  getIdleTexture() {
    return this.sprites["idle"]?.texture ?? this.sprites[this.animState]!.texture;
  }

  setAnimSet(animSet: AnimSet): void {
    if (animSet === this.animSet) return;
    this.animSet = animSet;
    for (const [state, sprite] of Object.entries(this.sprites)) {
      sprite.texture = getPlayerTexture(animSet, state as AnimState);
    }
    this.positionItemSprites();
  }

  setAnimState(state: AnimState): void {
    if (this.animState === state) return;
    if (this.sprites[this.animState]) this.sprites[this.animState]!.visible = false;
    if (this.sprites[state]) this.sprites[state]!.visible = true;
    this.animState = state;
    this.positionItemSprites();
  }

  setFacing(left: boolean): void {
    if (left === this.facingLeft) return;
    this.facingLeft = left;
    for (const s of Object.values(this.sprites)) {
      s.scale.x = left ? -this.scale : this.scale;
    }
    this.positionItemSprites();
  }

  setEquipment(
    equipped: readonly ItemDefinition[],
    attachments: Record<string, AttachmentData>,
  ): void {
    for (const s of this.itemSprites) {
      this.container.removeChild(s);
      s.destroy();
    }
    this.itemSprites = [];
    this.equipped = equipped;
    this.attachments = attachments;

    if (equipped.length === 0) return;
    this.initItemSprites();
  }

  private initItemSprites(): void {
    const equippedAtCall = this.equipped;
    loadCharacterAnchors("char1").then((data) => {
      if (!data || this.equipped !== equippedAtCall) return;
      this.characterAnchors = data;
      for (const item of this.equipped) {
        const sprite = new Sprite();
        sprite.anchor.set(0.5, 0.5);
        sprite.visible = false;
        this.container.addChild(sprite);
        this.itemSprites.push(sprite);
        loadItemTexture(item).then((tex) => {
          if (this.equipped !== equippedAtCall) return;
          if (tex) sprite.texture = tex;
          this.positionItemSprites();
        });
      }
      this.positionItemSprites();
    });
  }

  private positionItemSprites(): void {
    if (!this.characterAnchors) return;

    const frameKey = `${this.animSet}-${this.animState}`;
    const frameData = this.characterAnchors.frames[frameKey];
    if (!frameData) return;

    const targetAnchors = frameData.anchors;
    const targetHeight = frameData.height;

    for (let i = 0; i < this.equipped.length; i++) {
      const item = this.equipped[i]!;
      const sprite = this.itemSprites[i];
      if (!sprite) continue;

      if (sprite.texture.width === 0) {
        sprite.visible = false;
        continue;
      }

      const attachment = this.attachments[item.id];
      if (!attachment) {
        sprite.visible = false;
        continue;
      }

      const refFrameData = this.characterAnchors.frames[attachment.referenceFrame];
      if (!refFrameData) {
        sprite.visible = false;
        continue;
      }

      const result = transformAttachment(
        attachment,
        refFrameData.anchors as Partial<AnchorSet>,
        targetAnchors as Partial<AnchorSet>,
        targetHeight,
      );

      const tex = sprite.texture;
      const charDrawH = this.getIdleTexture().height * this.scale;
      const itemDrawH = (attachment.scale ?? 1) * charDrawH;
      const itemScale = itemDrawH / tex.height;
      const flipSign = this.facingLeft ? -1 : 1;

      sprite.position.set(
        (result.x - frameData.width / 2) * this.scale * flipSign,
        (result.y - frameData.height * 0.75) * this.scale,
      );
      sprite.scale.set(itemScale * flipSign, itemScale);
      sprite.rotation = result.rotation * (Math.PI / 180) * flipSign;
      sprite.visible = true;
    }
  }
}
