<script lang="ts">
  let { size = 54, swing = false }: { size?: number; swing?: boolean } = $props();
</script>

<svg class="compass" class:swing width={size} height={size} viewBox="0 0 74 74" fill="none" stroke="#3c2f1c" stroke-width="1.6">
  <circle cx="37" cy="37" r="33" opacity=".75" />
  <circle cx="37" cy="37" r="27" opacity=".4" />
  <path d="M37 8v8M37 58v8M8 37h8M58 37h8" opacity=".7" />
  <path class="needle" d="M37 16 L43 37 L37 58 L31 37 Z" fill="#9c3428" stroke="none" opacity=".85" />
  <circle cx="37" cy="37" r="2.6" fill="#3c2f1c" stroke="none" />
</svg>

<style>
  .compass {
    margin: 0 auto;
    opacity: 0.85;
    display: block;
  }
  .swing .needle {
    animation: swing 2.6s ease-in-out infinite;
    transform-origin: 37px 37px;
  }
  @keyframes swing {
    0%,
    100% {
      transform: rotate(-24deg);
    }
    50% {
      transform: rotate(31deg);
    }
  }
</style>
