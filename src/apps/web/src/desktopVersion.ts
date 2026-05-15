export function formatDesktopAppVersion(version: string | null | undefined): string {
  const normalized = version?.trim() ?? ''
  return import.meta.env.MODE === 'development' ? '' : normalized
}
