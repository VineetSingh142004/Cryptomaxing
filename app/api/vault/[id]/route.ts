import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/security/errors";import { deleteProviderCredential, runConnectionTest } from "@/lib/vault/store";

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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await deleteProviderCredential(id);
    return NextResponse.json(result);
  } catch (error) {
    const { error: body, statusCode } = toErrorResponse(error);
    return NextResponse.json(body, { status: statusCode });
  }
}
