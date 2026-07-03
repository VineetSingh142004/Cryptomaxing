import { NextResponse, type NextRequest } from "next/server";
import { isLocalOwnerModeEnabled } from "@/lib/security/local-owner";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  if (isLocalOwnerModeEnabled()) {
    return NextResponse.next({ request });
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
