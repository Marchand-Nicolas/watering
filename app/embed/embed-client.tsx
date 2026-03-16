"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Plant = {
  id: number;
  last_call?: string | null;
};

type Order = {
  id: number;
  plant_id: number;
  status: string;
  completed_date?: string | null;
  started_date?: string | null;
  date: string;
  duration: number;
};

const MS_PER_HOUR = 3_600_000;

function isLastCallOld(lastCall: string | null | undefined): boolean {
  if (!lastCall) return false;
  const t = Date.parse(lastCall);
  return Number.isFinite(t) && Date.now() - t > MS_PER_HOUR * 2;
}

function formatRelative(timestampMs: number): string {
  const diffMs = timestampMs - Date.now();
  const abs = Math.abs(diffMs);
  if (abs < 1_000) return "just now";
  const seconds = Math.round(Math.abs(diffMs) / 1_000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(abs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(abs / 86_400_000);
  return `${days}d ago`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "-";
  return new Date(parsed).toLocaleString();
}

type EmbedClientProps = {
  apiUrl: string;
};

export default function EmbedClient({ apiUrl }: EmbedClientProps) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [plants, setPlants] = useState<Plant[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [connectionStale, setConnectionStale] = useState(false);

  const normalizedApiUrl = useMemo(() => apiUrl.replace(/\/$/, ""), [apiUrl]);

  const loadPlants = useCallback(async () => {
    if (!token || !normalizedApiUrl) return;
    try {
      const res = await fetch(
        `${normalizedApiUrl}/api/dashboard/list_plants?token=${encodeURIComponent(token)}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { plants?: Plant[] };
      const list = data.plants ?? [];
      setPlants(list);
      setConnectionStale(list.some((p) => isLastCallOld(p.last_call)));
    } catch {
      // silently ignore — embed stays stale
    }
  }, [token, normalizedApiUrl]);

  const loadOrders = useCallback(async () => {
    if (!token || !normalizedApiUrl) return;
    for (const endpoint of ["/api/dashboard/orders", "/dashboard/orders"]) {
      try {
        const res = await fetch(
          `${normalizedApiUrl}${endpoint}?token=${encodeURIComponent(token)}`,
          {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          },
        );
        if (!res.ok) continue;
        const data = (await res.json()) as { orders?: Order[] };
        setOrders(data.orders ?? []);
        return;
      } catch {
        // try next endpoint
      }
    }
  }, [token, normalizedApiUrl]);

  useEffect(() => {
    if (!token || !normalizedApiUrl) return;

    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        await Promise.all([loadPlants(), loadOrders()]);
      } finally {
        busy = false;
      }
    };

    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [token, normalizedApiUrl, loadPlants, loadOrders]);

  // Last device update: most recent last_call across all plants
  const lastUpdateLabel = useMemo(() => {
    const latest = plants.reduce<number | null>((best, plant) => {
      if (!plant.last_call) return best;
      const t = Date.parse(plant.last_call);
      if (!Number.isFinite(t)) return best;
      return best === null || t > best ? t : best;
    }, null);
    return latest === null ? "-" : formatRelative(latest);
  }, [plants]);

  // Last completed watering: most recent completed order
  const lastCompleted = useMemo(() => {
    const completed = orders
      .filter((o) => o.status.toLowerCase() === "completed")
      .map((o) => {
        const candidate = o.completed_date ?? o.date;
        const t = Date.parse(candidate);
        return Number.isFinite(t) ? { order: o, timestamp: t } : null;
      })
      .filter((x): x is { order: Order; timestamp: number } => x !== null)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (completed.length === 0) return null;
    const { order, timestamp } = completed[0];
    return {
      relative: formatRelative(timestamp),
      absolute: formatDateTime(order.completed_date ?? order.date),
      duration: order.duration,
      plantId: order.plant_id,
    };
  }, [orders]);

  const missingToken = !token;
  const missingApi = !normalizedApiUrl;

  return (
    <div className="embed-root">
      <style>{`
        .embed-root {
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: .5rem;
          gap: 1rem;
          background: var(--embed-bg);
          color: var(--embed-fg);
          font-family: var(--font-geist-sans, system-ui, sans-serif);
          box-sizing: border-box;
        }

        :root {
          --embed-bg: #ffffff;
          --embed-fg: #111111;
          --embed-card-bg: #f4f4f5;
          --embed-card-border: #e4e4e7;
          --embed-label: #71717a;
          --embed-accent: #059669;
          --embed-stale: #dc2626;
          --embed-warn-bg: #fef2f2;
          --embed-warn-border: #fecaca;
          --embed-warn-fg: #991b1b;
        }

        @media (prefers-color-scheme: dark) {
          :root {
            --embed-bg: #191919;
            --embed-fg: #f5f5f5;
            --embed-card-bg: #18181b;
            --embed-card-border: #27272a;
            --embed-label: #a1a1aa;
            --embed-accent: #34d399;
            --embed-stale: #f87171;
            --embed-warn-bg: rgba(239,68,68,0.1);
            --embed-warn-border: rgba(239,68,68,0.3);
            --embed-warn-fg: #fca5a5;
          }
        }

        .embed-cards {
          width: 100%;
          max-width: 820px;
          display: flex;
          flex-direction: row;
          gap: 0.75rem;
        }

        .embed-card {
          flex: 1;
          min-width: 0;
          background: var(--embed-card-bg);
          border: 1px solid var(--embed-card-border);
          border-radius: 1rem;
          padding: 1.5rem 1.75rem;
        }

        .embed-card-label {
          font-size: 0.675rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--embed-label);
          margin: 0 0 0.5rem;
        }

        .embed-card-value {
          font-size: 2rem;
          font-weight: 600;
          color: var(--embed-fg);
          line-height: 1.15;
          margin: 0;
        }

        .embed-card-sub {
          font-size: 0.78rem;
          color: var(--embed-label);
          margin: 0.4rem 0 0;
        }

        .embed-dot {
          display: inline-block;
          width: 0.5rem;
          height: 0.5rem;
          border-radius: 50%;
          margin-right: 0.4rem;
          background: var(--embed-accent);
          vertical-align: middle;
        }

        .embed-dot.stale {
          background: var(--embed-stale);
        }

        .embed-alert {
          width: 100%;
          max-width: 540px;
          background: var(--embed-warn-bg);
          border: 1px solid var(--embed-warn-border);
          color: var(--embed-warn-fg);
          border-radius: 0.75rem;
          padding: 0.75rem 1rem;
          font-size: 0.8rem;
        }

        .embed-footer {
          font-size: 0.7rem;
          color: var(--embed-label);
          text-align: center;
          margin-top: 0.5rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
      `}</style>

      {missingToken && (
        <div className="embed-alert">
          Missing token — open this page with <code>?token=YOUR_TOKEN</code>
        </div>
      )}
      {missingApi && (
        <div className="embed-alert">API URL not configured on the server.</div>
      )}

      {!missingToken && !missingApi && (
        <div className="embed-cards">
          <div className="embed-card">
            <p className="embed-card-label">Last Update</p>
            <p className="embed-card-value">
              <span className={`embed-dot${connectionStale ? " stale" : ""}`} />
              {lastUpdateLabel}
            </p>
          </div>

          <div className="embed-card">
            <p className="embed-card-label">Last Watering</p>
            {lastCompleted === null ? (
              <p
                className="embed-card-value"
                style={{ fontSize: "1.2rem", color: "var(--embed-label)" }}
              >
                No completed waterings yet
              </p>
            ) : (
              <>
                <p className="embed-card-value">{lastCompleted.relative}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
