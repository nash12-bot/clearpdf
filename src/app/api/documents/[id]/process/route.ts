import { after, NextResponse } from "next/server";
import { documentExists, readOcrStatus, runAdobeOcr } from "@/lib/adobe-ocr";
import { consumeRateLimit, isSameOriginRequest } from "@/lib/request-guards";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OCR_RATE_LIMIT = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id) || !(await documentExists(id))) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  return NextResponse.json(await readOcrStatus(id), { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(_request)) return NextResponse.json({ error: "This processing request was rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const { id } = await params;
  if (!UUID_PATTERN.test(id) || !(await documentExists(id))) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  const status = await readOcrStatus(id);
  if (status.status === "completed") return NextResponse.json(status, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  if (status.status === "processing") return NextResponse.json(status, { status: 200, headers: { "Cache-Control": "private, no-store" } });

  const rateLimit = consumeRateLimit("adobe-ocr", OCR_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "The OCR processing limit has been reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  after(() => runAdobeOcr(id));
  return NextResponse.json({ status: "processing", startedAt: new Date().toISOString() }, { status: 202, headers: { "Cache-Control": "private, no-store" } });
}
