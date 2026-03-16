import { Suspense } from "react";
import EmbedClient from "./embed-client";

export default function EmbedPage() {
  const apiUrl =
    process.env.API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "";

  return (
    <Suspense fallback={<div className="embed-loading">Loading…</div>}>
      <EmbedClient apiUrl={apiUrl} />
    </Suspense>
  );
}
