import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/security/errors";
import { disableProviderCredential, runConnectionTest } from "@/lib/vault/store";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await runConnectionTest(id);
    return NextResponse.json(result);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}

const disableSchema = z.object({ reason: z.string().min(1).max(500) });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = disableSchema.safeParse(body);
    const reason = parsed.success ? parsed.data.reason : "Disabled by user";

    const credential = await disableProviderCredential(id, reason);
    return NextResponse.json(credential);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
