"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ActionButton from "@/components/arc/action-button/action-button";
import FileDropzone from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import styles from "./home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024;

type UploadedDocument = {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
};

export default function Home() {
  const router = useRouter();
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);

  const uploadFile: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      const formData = new FormData();
      formData.set("file", item.file);

      const request = new XMLHttpRequest();
      request.open("POST", "/api/documents");
      request.responseType = "json";
      request.timeout = 180_000;

      const removeAbortListener = () => signal.removeEventListener("abort", abortRequest);
      const abortRequest = () => request.abort();

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
      };
      request.onload = () => {
        removeAbortListener();
        const response = request.response as (UploadedDocument & { error?: string }) | null;
        if (request.status >= 200 && request.status < 300 && response?.id) {
          setUploadedDocument(response);
          resolve();
          return;
        }
        reject(new Error(response?.error ?? "The upload failed. Please try again."));
      };
      request.onerror = () => {
        removeAbortListener();
        reject(new Error("The server could not be reached. Check your connection and retry."));
      };
      request.ontimeout = () => {
        removeAbortListener();
        reject(new Error("The upload took too long. Please retry."));
      };
      request.onabort = () => {
        removeAbortListener();
        reject(new Error("The upload was canceled."));
      };

      if (signal.aborted) {
        request.abort();
        return;
      }
      signal.addEventListener("abort", abortRequest, { once: true });
      request.send(formData);
    });

  const handleProcess = async () => {
    if (uploadedDocument) router.push(`/documents/${uploadedDocument.id}`);
  };

  return (
    <main className={styles.page}>
      <div className={styles.uploader}>
        <FileDropzone
          className={styles.dropzone}
          borderless
          accept="application/pdf,.pdf"
          multiple={false}
          maxFiles={1}
          maxSize={MAX_PDF_SIZE}
          label="Drop your PDF here"
          description="or click to browse files from your device"
          note="PDF only · Up to 100 MB"
          dropLabel="Release to add your PDF"
          onUpload={uploadFile}
          onFilesChange={() => {
            setUploadedDocument(null);
          }}
        />
        {uploadedDocument && (
          <div className={styles.processAction}>
            <ActionButton
              label="Process"
              pendingLabel="Opening"
              successLabel="Opening"
              onAction={handleProcess}
            />
          </div>
        )}
      </div>
    </main>
  );
}
