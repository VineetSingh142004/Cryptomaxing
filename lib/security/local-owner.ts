/** Single-user local owner mode — personal use only, no Supabase Auth required */

export function isLocalOwnerModeEnabled(): boolean {
  return process.env.APP_MODE === "local" && process.env.LOCAL_OWNER_MODE === "true";
}

export function isLocalOwnerModeUnsafeInProduction(): boolean {
  return isLocalOwnerModeEnabled() && process.env.NODE_ENV === "production";
}

/** Local owner mode allowed for vault/mode mutations (development/local only) */
export function isLocalOwnerModeAllowed(): boolean {
  return isLocalOwnerModeEnabled() && !isLocalOwnerModeUnsafeInProduction();
}
