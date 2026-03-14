import { Suspense } from "react";
import DashboardClient from "./dashboard-client";

export default function Home() {
  const apiUrl =
    process.env.API_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    "";

  return (
    <Suspense fallback={<div>Loading dashboard...</div>}>
      <DashboardClient apiUrl={apiUrl} />
    </Suspense>
  );
}
