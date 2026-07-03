import { AppError } from "@/lib/security/errors";
import {
  DEFAULT_SYSTEM_USER_EMAIL,
  LOCAL_OWNER_DISPLAY_ID,
  LOCAL_OWNER_EMAIL,
} from "@/lib/config/constants";
import {
  isLocalOwnerModeAllowed,
  isLocalOwnerModeEnabled,
  isLocalOwnerModeUnsafeInProduction,
} from "@/lib/security/local-owner";

export type AuthStatusCode =
  | "AUTH_READY"
  | "AUTH_NOT_CONFIGURED"
  | "AUTH_REQUIRED"
  | "AUTH_NOT_IMPLEMENTED"
  | "LOCAL_OWNER_MODE"
  | "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION";

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  supabaseId: string;
}

export interface AuthStatus {
  implemented: boolean;
  configured: boolean;
  status: AuthStatusCode;
  message: string;
  user: { id: string; email: string } | null;
  localOwnerMode?: boolean;
}

export function isAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function isAuthImplemented(): boolean {
  return isLocalOwnerModeAllowed() || isAuthConfigured();
}

async function upsertLocalOwnerUser(): Promise<AuthUser> {
  const { prisma } = await import("@/lib/db/client");
  const dbUser = await prisma.user.upsert({
    where: { email: LOCAL_OWNER_EMAIL },
    create: { email: LOCAL_OWNER_EMAIL, name: "Local Owner" },
    update: { name: "Local Owner" },
  });
  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    supabaseId: LOCAL_OWNER_DISPLAY_ID,
  };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  if (isLocalOwnerModeAllowed()) {
    return upsertLocalOwnerUser();
  }

  if (!isAuthConfigured()) return null;

  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user?.email) return null;

  const { prisma } = await import("@/lib/db/client");
  const dbUser = await prisma.user.upsert({
    where: { email: data.user.email },
    create: {
      email: data.user.email,
      name: data.user.user_metadata?.full_name ?? data.user.email.split("@")[0],
    },
    update: {
      name: data.user.user_metadata?.full_name ?? undefined,
    },
  });

  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    supabaseId: data.user.id,
  };
}

export async function requireAuth(): Promise<AuthUser> {
  if (isLocalOwnerModeUnsafeInProduction()) {
    throw new AppError("FORBIDDEN", "Local owner mode is unsafe in production", {
      reasonCode: "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION",
    });
  }

  if (isLocalOwnerModeAllowed()) {
    return upsertLocalOwnerUser();
  }

  if (!isAuthConfigured()) {
    throw new AppError("UNAUTHORIZED", "Authentication is not configured", {
      reasonCode: "AUTH_NOT_CONFIGURED",
    });
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new AppError("UNAUTHORIZED", "Sign in required", {
      reasonCode: "AUTH_REQUIRED",
    });
  }

  return user;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  if (isLocalOwnerModeUnsafeInProduction()) {
    return {
      implemented: false,
      configured: false,
      status: "LOCAL_OWNER_MODE_UNSAFE_IN_PRODUCTION",
      message: "LOCAL_OWNER_MODE is not allowed in production — use Supabase Auth before deployment",
      user: null,
      localOwnerMode: true,
    };
  }

  if (isLocalOwnerModeAllowed()) {
    const user = await upsertLocalOwnerUser();
    return {
      implemented: true,
      configured: true,
      status: "LOCAL_OWNER_MODE",
      message: "Single-user local owner mode — do not expose this app publicly",
      user: { id: user.id, email: user.email },
      localOwnerMode: true,
    };
  }

  if (!isAuthConfigured()) {
    return {
      implemented: false,
      configured: false,
      status: "AUTH_NOT_CONFIGURED",
      message: "Set APP_MODE=local + LOCAL_OWNER_MODE=true, or configure Supabase Auth",
      user: null,
    };
  }

  const user = await getCurrentUser();
  if (user) {
    return {
      implemented: true,
      configured: true,
      status: "AUTH_READY",
      message: "Signed in",
      user: { id: user.id, email: user.email },
    };
  }

  return {
    implemented: true,
    configured: true,
    status: "AUTH_REQUIRED",
    message: "Sign in to access vault, mode changes, and user-specific data",
    user: null,
  };
}

/** Resolve user ID for scoped data access */
export async function resolveUserId(options?: { requireAuth?: boolean }): Promise<string> {
  if (isLocalOwnerModeAllowed()) {
    const user = await upsertLocalOwnerUser();
    return user.id;
  }

  if (isAuthConfigured()) {
    if (options?.requireAuth) {
      const user = await requireAuth();
      return user.id;
    }
    const user = await getCurrentUser();
    if (user) return user.id;
    throw new AppError("UNAUTHORIZED", "Sign in required", {
      reasonCode: "AUTH_REQUIRED",
    });
  }

  const { prisma } = await import("@/lib/db/client");
  const user = await prisma.user.upsert({
    where: { email: DEFAULT_SYSTEM_USER_EMAIL },
    create: { email: DEFAULT_SYSTEM_USER_EMAIL, name: "System" },
    update: {},
  });
  return user.id;
}

export async function assertUserOwnsResource(resourceUserId: string): Promise<void> {
  const userId = await resolveUserId({ requireAuth: true });
  if (resourceUserId !== userId) {
    throw new AppError("FORBIDDEN", "Access denied", {
      reasonCode: "AUTH_FORBIDDEN",
    });
  }
}

export { isLocalOwnerModeEnabled, isLocalOwnerModeAllowed, isLocalOwnerModeUnsafeInProduction };
