import { Suspense } from "react";
import Workspace from "./workspace";

function WorkspaceFromParams({ params }: { params: Promise<{ id: string }> }) {
  return <DocumentResolver params={params} />;
}

async function DocumentResolver({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace key={id} documentId={id} />;
}

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<main style={{ display: "grid", minHeight: "100svh", placeItems: "center", background: "#f4f5f6", color: "#747a80", fontFamily: "Arial, sans-serif", fontSize: 12 }}>Opening document…</main>}>
      <WorkspaceFromParams params={params} />
    </Suspense>
  );
}
