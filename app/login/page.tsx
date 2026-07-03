"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { APP_NAME } from "@/lib/config/constants";

export default function LoginPage() {
  const [authStatus, setAuthStatus] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data: { status?: string }) => setAuthStatus(data.status ?? null))
      .catch(() => setAuthStatus(null));
  }, []);

  if (authStatus === "LOCAL_OWNER_MODE") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>{APP_NAME}</CardTitle>
            <CardDescription>Login disabled because LOCAL_OWNER_MODE is enabled.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/" className="text-sm text-primary hover:underline">
              ← Back to dashboard
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{APP_NAME}</CardTitle>
          <CardDescription>
            For personal local use, set APP_MODE=local and LOCAL_OWNER_MODE=true in .env instead of
            using login.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Supabase login is optional. Enable Local Owner Mode for single-user personal testing.
          </p>
          <Link href="/" className="text-sm text-primary hover:underline">
            ← Back to dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
