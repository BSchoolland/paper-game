<script lang="ts">
  import { itemSpriteUrl } from "../lib/urls.js";
  import { dimMeta } from "../state/dim-meta.svelte.js";
  import { assetUrl } from "../lib/urls.js";

  /**
   * An item sprite in a framed chip. Sprite extension differs per dimension (.webp vs .png):
   * dimension-0 starters are always webp; every other dimension's extension comes from the
   * server-resolved `itemSprites` map in its dimension meta. Until that meta loads the chip
   * renders empty (visible, not a guessed-and-maybe-404 image).
   */
  let {
    item,
    small = false,
  }: {
    item: { sprite: string; dimensionId: number; name?: string };
    small?: boolean;
  } = $props();

  const src = $derived.by(() => {
    if (item.dimensionId === 0) return itemSpriteUrl(item);
    const resolved = dimMeta.byId[item.dimensionId]?.itemSprites[item.sprite];
    return resolved ? assetUrl(resolved) : null;
  });
</script>

<span class="chip" class:sm={small}>
  {#if src}<img {src} alt={item.name ?? item.sprite} />{/if}
</span>
