import { stat } from "node:fs/promises";
import path from "node:path";
import { getUploadsDirectory } from "@/lib/storage";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import PrintDocument from "./print-document";

const STORAGE_DIR = getUploadsDirectory();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function PrintFallback() {
  return <main style={{ minHeight: "100svh", display: "grid", placeItems: "center", color: "#555b64", fontFamily: "Arial, Helvetica, sans-serif" }}>Preparing original PDF…</main>;
}

async function PrintPageContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) notFound();

  await connection();

  try {
    await Promise.all([
      stat(path.join(STORAGE_DIR, `${id}.json`)),
      stat(path.join(STORAGE_DIR, `${id}.pdf`)),
    ]);
  } catch {
    notFound();
  }

  return <PrintDocument documentId={id} />;
}

export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={<PrintFallback />}><PrintPageContent params={params} /></Suspense>;
}
