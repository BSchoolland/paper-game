/**
 * Full-screen load gate. Any async work that must finish before the board is presentable
 * (base sprite atlases, a dimension's sprites, the encounter map image) registers here;
 * LoadingOverlay covers the screen while anything is pending.
 */
interface LoadingStore {
  jobs: string[];
}

export const loading = $state<LoadingStore>({ jobs: [] });

export function loadingActive(): boolean {
  return loading.jobs.length > 0;
}

/** Cover the screen with `label` until `work` settles. Resolves/rejects with `work`. */
export async function trackLoading<T>(label: string, work: Promise<T>): Promise<T> {
  loading.jobs.push(label);
  try {
    return await work;
  } finally {
    const i = loading.jobs.indexOf(label);
    if (i !== -1) loading.jobs.splice(i, 1);
  }
}
