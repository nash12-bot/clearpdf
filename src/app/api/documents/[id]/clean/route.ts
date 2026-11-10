import { readFile } from "node:fs/promises";
import path from "node:path";
import { getUploadsDirectory } from "@/lib/storage";
import { NextResponse } from "next/server";
import { documentExists, documentPaths, readOcrStatus } from "@/lib/adobe-ocr";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPLOADS_DIR = getUploadsDirectory();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id) || !(await documentExists(id))) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  const status = await readOcrStatus(id);
  if (status.status !== "completed") return NextResponse.json({ error: "The cleaned PDF is not ready yet." }, { status: 409 });

  try {
    const [metadataText, pdf] = await Promise.all([
      readFile(path.join(UPLOADS_DIR, `${id}.json`), "utf8"),
      readFile(documentPaths(id).clean),
    ]);
    const metadata = JSON.parse(metadataText) as { filename: string };
    const name = encodeURIComponent(metadata.filename.replace(/\.pdf$/i, "") + " (cleaned).pdf").replaceAll("'", "%27");
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${name}`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "The cleaned PDF could not be found. Retry OCR processing." }, { status: 404 });
  }
}
