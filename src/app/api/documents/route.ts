import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUploadsDirectory } from "@/lib/storage";
import { NextResponse } from "next/server";
import { consumeRateLimit, isSameOriginRequest } from "@/lib/request-guards";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const MAX_MULTIPART_SIZE = MAX_PDF_SIZE + 1024 * 1024;
const UPLOAD_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const STORAGE_DIR = getUploadsDirectory();

type UploadMetadata = {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
};

function safeFilename(filename: string) {
  const basename = filename.replaceAll("\\", "/").split("/").pop() ?? "document.pdf";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "document.pdf";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This upload request was rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (!contentLengthHeader || !/^\d+$/.test(contentLengthHeader)) {
    return NextResponse.json({ error: "The upload request must include a valid content length." }, { status: 411, headers: { "Cache-Control": "no-store" } });
  }
  const contentLength = Number(contentLengthHeader);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_MULTIPART_SIZE) {
    return NextResponse.json({ error: "PDFs must be 100 MB or smaller." }, { status: 413 });
  }

  const rateLimit = consumeRateLimit("pdf-upload", UPLOAD_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "The upload limit has been reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "The upload could not be read." }, { status: 400 });
  }

  const entry = form.get("file");
  if (!(entry instanceof File)) {
    return NextResponse.json({ error: "Choose a PDF file to upload." }, { status: 400 });
  }

  const filename = safeFilename(entry.name);
  if (!filename.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 415 });
  }
  if (entry.size === 0) {
    return NextResponse.json({ error: "This PDF is empty." }, { status: 400 });
  }
  if (entry.size > MAX_PDF_SIZE) {
    return NextResponse.json({ error: "PDFs must be 100 MB or smaller." }, { status: 413 });
  }

  const bytes = Buffer.from(await entry.arrayBuffer());
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
    return NextResponse.json({ error: "The selected file does not contain a valid PDF header." }, { status: 415 });
  }

  const metadata: UploadMetadata = {
    id: randomUUID(),
    filename,
    size: entry.size,
    uploadedAt: new Date().toISOString(),
  };
  const pdfPath = path.join(STORAGE_DIR, `${metadata.id}.pdf`);
  const metadataPath = path.join(STORAGE_DIR, `${metadata.id}.json`);

  try {
    await mkdir(STORAGE_DIR, { recursive: true, mode: 0o700 });
    await writeFile(pdfPath, bytes, { flag: "wx", mode: 0o600 });
    await writeFile(metadataPath, JSON.stringify(metadata), { flag: "wx", mode: 0o600 });
  } catch {
    await Promise.allSettled([
      rm(pdfPath, { force: true }),
      rm(metadataPath, { force: true }),
    ]);
    return NextResponse.json({ error: "The PDF could not be saved. Please retry the upload." }, { status: 500 });
  }

  return NextResponse.json(metadata, { status: 201 });
}
