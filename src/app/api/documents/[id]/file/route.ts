import { readFile } from "node:fs/promises";
import path from "node:path";
import { getUploadsDirectory } from "@/lib/storage";
import { NextResponse } from "next/server";

const STORAGE_DIR = getUploadsDirectory();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  try {
    const [metadataText, pdf] = await Promise.all([
      readFile(path.join(STORAGE_DIR, `${id}.json`), "utf8"),
      readFile(path.join(STORAGE_DIR, `${id}.pdf`)),
    ]);
    const metadata = JSON.parse(metadataText) as { filename: string };
    const download = new URL(request.url).searchParams.get("download") === "1";
    const safeName = encodeURIComponent(metadata.filename).replaceAll("'", "%27");

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${safeName}`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
}
