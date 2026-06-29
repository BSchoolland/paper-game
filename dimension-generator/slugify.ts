// Canonical slug used for BOTH sprite filenames and template ids, so the two can never diverge.
// Drops apostrophes (Hunter's -> hunters) rather than turning them into dashes (hunter-s), which once
// silently broke the sprite-to-template link. Collapses any other non-alphanumeric run to one dash.
export function slugify(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
