import type { FriendsListPayload } from "shared";
import type { FieldError } from "./session.svelte.js";

interface SocialStore {
  /** Null until the first friendsList lands (claimed accounts get one right after welcome). */
  friends: FriendsListPayload | null;
  /** Inline error for the add-by-username row (NO_SUCH_USER, CLAIM_REQUIRED, INVALID_INPUT). */
  addError: FieldError | null;
}

function initial(): SocialStore {
  return { friends: null, addError: null };
}

export const social = $state<SocialStore>(initial());

export function resetSocial(): void {
  Object.assign(social, initial());
}
