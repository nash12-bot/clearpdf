"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import styles from "./print.module.css";

export default function PrintDocument({ documentId }: { documentId: string }) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [readyPages, setReadyPages] = useState(0);
  const [error, setError] = useState("");
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const printRequested = useRef(false);
  const pdfUrl = `/api/documents/${documentId}/file`;

  useEffect(() => {
    let active = true;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null = null;

    const loadPdf = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ url: pdfUrl });
        loadingTask = task;
        const document = await task.promise;
        if (!active) {
          await task.destroy();
          return;
        }
        setPdfDocument(document);
      } catch {
        if (active) setError("The original PDF could not be prepared for printing. Download it and print it from your PDF viewer.");
      }
    };

    void loadPdf();
    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy().catch(() => undefined);
    };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdfDocument) return;
    let canceled = false;
    const renderTasks: RenderTask[] = [];

    const renderPages = async () => {
      try {
        const outputScale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const canvas = canvasRefs.current[pageNumber - 1];
          if (!canvas) throw new Error("A print page could not be created.");
          const page = await pdfDocument.getPage(pageNumber);
          if (canceled) return;
          const viewport = page.getViewport({ scale: 4 / 3 });
          const context = canvas.getContext("2d");
          if (!context) throw new Error("The browser could not render this PDF page.");
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          const task = page.render({
            canvas,
            canvasContext: context,
            viewport,
            transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
          });
          renderTasks.push(task);
          await task.promise;
          if (canceled) return;
          setReadyPages(pageNumber);
        }
      } catch {
        if (!canceled) setError("A page could not be prepared for printing. Download the original PDF and print it from your PDF viewer.");
      }
    };

    void renderPages();
    return () => {
      canceled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  }, [pdfDocument]);

  useEffect(() => {
    if (!pdfDocument || error || readyPages !== pdfDocument.numPages || printRequested.current) return;
    printRequested.current = true;
    const timer = window.setTimeout(() => window.print(), 500);
    return () => window.clearTimeout(timer);
  }, [pdfDocument, readyPages, error]);

  const isReady = Boolean(pdfDocument) && readyPages === pdfDocument?.numPages && !error;

  return (
    <main className={styles.printPage}>
      <header className={styles.printHeader}>
        <span role="status">{error || (isReady ? "Print dialog opening…" : `Preparing original PDF… ${readyPages}${pdfDocument ? ` / ${pdfDocument.numPages}` : ""}`)}</span>
        <button type="button" disabled={!isReady} onClick={() => window.print()}>Print now</button>
      </header>
      <div className={styles.printPages}>
        {pdfDocument && Array.from({ length: pdfDocument.numPages }, (_, index) => (
          <section className={styles.printSheet} key={index} aria-label={`Print page ${index + 1}`}>
            <canvas ref={(canvas) => { canvasRefs.current[index] = canvas; }} className={styles.printCanvas} />
          </section>
        ))}
      </div>
    </main>
  );
}
