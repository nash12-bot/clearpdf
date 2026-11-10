import { createReadStream, createWriteStream } from "node:fs";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUploadsDirectory } from "@/lib/storage";
import { pipeline } from "node:stream/promises";
import {
  CreatePDFJob,
  CreatePDFParams,
  CreatePDFResult,
  DocumentLanguage,
  ExportOCRLocale,
  ExportPDFJob,
  ExportPDFParams,
  ExportPDFResult,
  ExportPDFTargetFormat,
  MimeType,
  PDFServices,
  ServicePrincipalCredentials,
} from "@adobe/pdfservices-node-sdk";

const STORAGE_DIR = getUploadsDirectory();
const MAX_ADOBE_FILE_SIZE = 100 * 1024 * 1024;
const OCR_WARNING = "OCR can misread a scan and DOCX reconstruction can shift spacing. Verify names, dates, amounts, and reference numbers against the original PDF.";

export type OcrProcessingStatus = {
  status: "not_started" | "processing" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  totalPages?: number;
  completedPages?: number;
  failedPages?: number;
  warning?: string;
  error?: string;
  conversion?: "native-preserved" | "reconstructed";
};

export function documentPaths(id: string) {
  return {
    original: path.join(STORAGE_DIR, `${id}.pdf`),
    metadata: path.join(STORAGE_DIR, `${id}.json`),
    clean: path.join(STORAGE_DIR, `${id}.clean.pdf`),
    status: path.join(STORAGE_DIR, `${id}.ocr.json`),
    lock: path.join(STORAGE_DIR, `${id}.ocr.lock`),
  };
}

export async function readOcrStatus(id: string): Promise<OcrProcessingStatus> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ documentPaths(id).status, "utf8")) as OcrProcessingStatus;
  } catch {
    return { status: "not_started" };
  }
}

async function writeOcrStatus(id: string, value: OcrProcessingStatus) {
  const target = documentPaths(id).status;
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, target);
}

function isPdf(bytes: Uint8Array) {
  return new TextDecoder("ascii").decode(bytes.subarray(0, 1024)).includes("%PDF-");
}

function getAdobeCredentials() {
  const clientId = process.env.PDF_SERVICES_CLIENT_ID?.trim();
  const clientSecret = process.env.PDF_SERVICES_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function getOcrLocale() {
  const locale = process.env.PDF_SERVICES_OCR_LOCALE?.trim();
  if (!locale) return ExportOCRLocale.EN_US;
  const supported = Object.values(ExportOCRLocale).find((candidate) => candidate.toLowerCase() === locale.toLowerCase());
  if (!supported) throw new Error("Unsupported Adobe OCR locale configuration.");
  return supported;
}

async function acquireLock(lockPath: string) {
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const lockInfo = await stat(lockPath).catch(() => null);
    if (!lockInfo || Date.now() - lockInfo.mtimeMs > 30 * 60 * 1000) {
      await rm(lockPath, { force: true });
      return acquireLock(lockPath);
    }
    return false;
  }
}

async function inspectPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  try {
    const pdf = await loadingTask.promise;
    let textCharacters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      textCharacters += content.items.reduce((sum, item) => sum + ("str" in item ? item.str.trim().length : 0), 0);
    }
    return { pageCount: pdf.numPages, textCharacters };
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }
}

export async function runAdobeOcr(id: string) {
  const paths = documentPaths(id);
  const locked = await acquireLock(paths.lock);
  if (!locked) return;

  const temporaryOutput = `${paths.clean}.${process.pid}.tmp`;
  const temporaryDocx = `${paths.clean}.${process.pid}.docx.tmp`;
  let totalPages: number | undefined;
  try {
    const inputBytes = await readFile(/*turbopackIgnore: true*/ paths.original);
    if (inputBytes.byteLength > MAX_ADOBE_FILE_SIZE) throw new Error("Adobe PDF Services accepts PDFs up to 100 MB. This file is too large to process.");
    if (!isPdf(inputBytes)) throw new Error("This file is not a valid PDF.");

    const inspection = await inspectPdf(inputBytes);
    totalPages = inspection.pageCount;
    const searchableThreshold = Math.max(80, totalPages * 30);

    // Keep already-digital PDFs exactly as supplied. Rebuilding them through DOCX would needlessly risk layout drift.
    if (inspection.textCharacters >= searchableThreshold) {
      await writeFile(temporaryOutput, inputBytes, { mode: 0o600 });
      await rename(temporaryOutput, paths.clean);
      await writeOcrStatus(id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        totalPages,
        completedPages: totalPages,
        failedPages: 0,
        conversion: "native-preserved",
        warning: "This PDF already had selectable text, so its existing layout was preserved unchanged.",
      });
      return;
    }

    const credentials = getAdobeCredentials();
    if (!credentials) throw new Error("Adobe PDF Services credentials are missing. Set PDF_SERVICES_CLIENT_ID and PDF_SERVICES_CLIENT_SECRET in the server environment, then retry.");
    const ocrLocale = getOcrLocale();
    const startedAt = new Date().toISOString();
    await writeOcrStatus(id, {
      status: "processing",
      startedAt,
      totalPages,
      completedPages: 0,
      failedPages: 0,
      warning: OCR_WARNING,
      conversion: "reconstructed",
    });

    const pdfServices = new PDFServices({ credentials: new ServicePrincipalCredentials(credentials) });
    const remoteAssets: Array<Awaited<ReturnType<typeof pdfServices.upload>>> = [];
    const pdfInputStream = createReadStream(/*turbopackIgnore: true*/ paths.original);
    let docxInputStream: ReturnType<typeof createReadStream> | undefined;
    try {
      const inputAsset = await pdfServices.upload({ readStream: pdfInputStream, mimeType: MimeType.PDF });
      remoteAssets.push(inputAsset);

      // Adobe Export PDF performs OCR on the scan and converts recognized content into editable DOCX elements.
      const exportParams = new ExportPDFParams({ targetFormat: ExportPDFTargetFormat.DOCX, ocrLocale });
      const exportJob = new ExportPDFJob({ inputAsset, params: exportParams });
      const exportPollingUrl = await pdfServices.submit({ job: exportJob });
      const exportResponse = await pdfServices.getJobResult({ pollingURL: exportPollingUrl, resultType: ExportPDFResult });
      if (!exportResponse.result) throw new Error("Adobe did not return the reconstructed document.");
      const docxAsset = exportResponse.result.asset;
      remoteAssets.push(docxAsset);
      const docxStream = await pdfServices.getContent({ asset: docxAsset });
      await pipeline(docxStream.readStream, createWriteStream(temporaryDocx, { mode: 0o600 }));

      const docxInfo = await stat(temporaryDocx);
      if (docxInfo.size < 100) throw new Error("Adobe returned an incomplete reconstructed document.");

      // Convert Adobe's editable reconstruction back to a searchable, selectable PDF.
      docxInputStream = createReadStream(temporaryDocx);
      const docxInputAsset = await pdfServices.upload({ readStream: docxInputStream, mimeType: MimeType.DOCX });
      remoteAssets.push(docxInputAsset);
      const createParams = new CreatePDFParams({ documentLanguage: DocumentLanguage.EN_US });
      const createJob = new CreatePDFJob({ inputAsset: docxInputAsset, params: createParams });
      const createPollingUrl = await pdfServices.submit({ job: createJob });
      const createResponse = await pdfServices.getJobResult({ pollingURL: createPollingUrl, resultType: CreatePDFResult });
      if (!createResponse.result) throw new Error("Adobe did not return the clean PDF.");
      const cleanAsset = createResponse.result.asset;
      remoteAssets.push(cleanAsset);
      const cleanStream = await pdfServices.getContent({ asset: cleanAsset });
      await pipeline(cleanStream.readStream, createWriteStream(temporaryOutput, { mode: 0o600 }));
    } finally {
      pdfInputStream.destroy();
      docxInputStream?.destroy();
      await Promise.allSettled(remoteAssets.map((asset) => pdfServices.deleteAsset({ asset })));
    }

    const outputBytes = await readFile(temporaryOutput);
    if (!isPdf(outputBytes)) throw new Error("Adobe completed the conversion but returned an invalid PDF file.");
    const outputInspection = await inspectPdf(outputBytes);
    if (outputInspection.pageCount !== totalPages) {
      throw new Error(`The recreated PDF has ${outputInspection.pageCount} pages, while the scanned original has ${totalPages}. The clean copy was not saved so you can verify the original layout.`);
    }
    if (outputInspection.textCharacters < 20) {
      throw new Error("The recreated PDF has no usable selectable text. The scan may be too blurry for reliable OCR; the original is unchanged.");
    }

    await rename(temporaryOutput, paths.clean);
    await writeOcrStatus(id, {
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      totalPages,
      completedPages: totalPages,
      failedPages: 0,
      conversion: "reconstructed",
      warning: OCR_WARNING,
    });
  } catch (error) {
    console.error("Adobe PDF OCR and reconstruction failed", error);
    await writeOcrStatus(id, {
      status: "failed",
      startedAt: (await readOcrStatus(id)).startedAt,
      completedAt: new Date().toISOString(),
      totalPages,
      failedPages: totalPages ?? 1,
      warning: OCR_WARNING,
      error: error instanceof Error ? error.message : "Adobe could not reconstruct this scanned PDF. Please retry.",
    }).catch(() => undefined);
  } finally {
    await rm(temporaryOutput, { force: true }).catch(() => undefined);
    await rm(temporaryDocx, { force: true }).catch(() => undefined);
    await rm(paths.lock, { force: true }).catch(() => undefined);
  }
}

export async function documentExists(id: string) {
  try {
    await Promise.all([
      stat(/*turbopackIgnore: true*/ documentPaths(id).metadata),
      stat(/*turbopackIgnore: true*/ documentPaths(id).original),
    ]);
    return true;
  } catch {
    return false;
  }
}
