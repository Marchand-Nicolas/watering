"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";

type Plant = {
  id: number;
  watering_duration: number;
  enabled: boolean;
  watering_frequency: number;
  last_call?: string | null;
  is_last_call_stale?: boolean;
};

type Order = {
  id: number;
  plant_id: number;
  date: string;
  duration: number;
  status: string;
  started_date?: string | null;
  completed_date?: string | null;
};

type ApiError = {
  error?: string;
  message?: string;
};

type CompletedWateringPoint = {
  orderId: number;
  plantId: number;
  timestamp: number;
  duration: number;
  label: string;
};

const SECONDS_PER_DAY = 86_400;
const MS_PER_HOUR = 3_600_000;
const CHART_COLORS = [
  "#34d399",
  "#60a5fa",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#22d3ee",
  "#f87171",
  "#84cc16",
  "#fb7185",
  "#2dd4bf",
  "#eab308",
  "#c084fc",
];

function secondsToDays(seconds: number): string {
  const days = seconds / SECONDS_PER_DAY;
  return Number.isInteger(days) ? String(days) : days.toFixed(2);
}

function daysToSeconds(daysText: string): number {
  const days = Number.parseFloat(daysText);
  if (!Number.isFinite(days) || days <= 0) {
    return Number.NaN;
  }

  return Math.round(days * SECONDS_PER_DAY);
}

function isLastCallOld(lastCall: string | null | undefined): boolean {
  if (!lastCall) {
    return false;
  }

  const lastCallTime = Date.parse(lastCall);
  if (!Number.isFinite(lastCallTime)) {
    return false;
  }

  return Date.now() - lastCallTime > MS_PER_HOUR * 2;
}

function formatRelativeTimeFromNow(timestampMs: number): string {
  const diffMs = timestampMs - Date.now();
  const absDiffMs = Math.abs(diffMs);

  if (absDiffMs < 1_000) {
    return "just now";
  }
  const seconds = Math.round(diffMs / 1_000);
  if (Math.abs(seconds) < 60) {
    return `${Math.abs(seconds)}s ago`;
  }

  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) {
    return `${Math.abs(minutes)}m ago`;
  }

  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) {
    return `${Math.abs(hours)}h ago`;
  }

  const days = Math.round(diffMs / 86_400_000);
  return `${Math.abs(days)}d ago`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return "-";
  }

  return new Date(parsed).toLocaleString();
}

function computeActualDurationSeconds(
  startedDate: string | null | undefined,
  completedDate: string | null | undefined,
): number | null {
  if (!startedDate || !completedDate) {
    return null;
  }

  const started = Date.parse(startedDate);
  const completed = Date.parse(completedDate);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    return null;
  }

  const durationMs = completed - started;
  if (durationMs < 0) {
    return null;
  }

  return Math.round(durationMs / 1_000);
}

function getCompletedWateringTimestamp(order: Order): number | null {
  const candidate = order.completed_date ?? order.date;
  const parsed = Date.parse(candidate);

  return Number.isFinite(parsed) ? parsed : null;
}

function getCompletedWateringDuration(order: Order): number {
  return (
    computeActualDurationSeconds(order.started_date, order.completed_date) ??
    order.duration
  );
}

function getStartOfDayTimestamp(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function getMinutesSinceMidnight(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

function formatTimeOfDay(minutes: number): string {
  const normalizedMinutes = Math.max(0, Math.min(1_439, Math.round(minutes)));
  const hours = Math.floor(normalizedMinutes / 60);
  const remainingMinutes = normalizedMinutes % 60;

  return `${hours.toString().padStart(2, "0")}:${remainingMinutes
    .toString()
    .padStart(2, "0")}`;
}

type DashboardClientProps = {
  apiUrl: string;
};

export default function DashboardClient({ apiUrl }: DashboardClientProps) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [plants, setPlants] = useState<Plant[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [durationInput, setDurationInput] = useState("15");
  const [frequencyInput, setFrequencyInput] = useState("1");
  const [enabledInput, setEnabledInput] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [orderingId, setOrderingId] = useState<number | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<number | null>(null);
  const [detailsPlantId, setDetailsPlantId] = useState<number | null>(null);
  const [orderDurationInput, setOrderDurationInput] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);

  const normalizedApiUrl = useMemo(() => apiUrl.replace(/\/$/, ""), [apiUrl]);

  const parseApiError = async (response: Response) => {
    let data: ApiError | null = null;

    try {
      data = (await response.json()) as ApiError;
    } catch {
      data = null;
    }

    return (
      data?.error || data?.message || `Request failed with ${response.status}`
    );
  };

  const loadPlants = useCallback(async () => {
    if (!token || !normalizedApiUrl) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${normalizedApiUrl}/api/dashboard/list_plants?token=${encodeURIComponent(token)}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const data = (await response.json()) as { plants?: Plant[] };
      const normalizedPlants = (data.plants ?? []).map((plant) => ({
        ...plant,
        is_last_call_stale: isLastCallOld(plant.last_call),
      }));
      setPlants(normalizedPlants);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load plants",
      );
    } finally {
      setLoading(false);
    }
  }, [token, normalizedApiUrl]);

  const loadOrders = useCallback(async () => {
    if (!token || !normalizedApiUrl) {
      return;
    }

    const endpoints = ["/api/dashboard/orders", "/dashboard/orders"];
    let lastError: Error | null = null;

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(
          `${normalizedApiUrl}${endpoint}?token=${encodeURIComponent(token)}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
            },
            cache: "no-store",
          },
        );

        if (!response.ok) {
          lastError = new Error(await parseApiError(response));
          continue;
        }

        const data = (await response.json()) as { orders?: Order[] };
        setOrders(data.orders ?? []);
        return;
      } catch (loadError) {
        lastError =
          loadError instanceof Error
            ? loadError
            : new Error("Unable to load orders");
      }
    }

    setOrders([]);
    if (lastError) {
      setError(lastError.message);
    }
  }, [token, normalizedApiUrl]);

  const handleCreatePlant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const duration = Number.parseInt(durationInput, 10);
    const frequencySeconds = daysToSeconds(frequencyInput);

    if (!Number.isInteger(duration) || duration <= 0) {
      setError("Watering duration must be a positive integer.");
      return;
    }

    if (!Number.isInteger(frequencySeconds) || frequencySeconds <= 0) {
      setError("Watering frequency must be a positive number of days.");
      return;
    }

    if (!token) {
      setError("Missing token in URL. Use ?token=YOUR_DEVICE_TOKEN");
      return;
    }

    if (!normalizedApiUrl) {
      setError("Missing API_URL in environment variables.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch(
        `${normalizedApiUrl}/api/dashboard/create_plant`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            token,
            watering_duration: duration,
            watering_frequency: frequencySeconds,
            enabled: enabledInput,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      setSuccess("Plant created successfully.");
      setDurationInput("15");
      setFrequencyInput("1");
      setEnabledInput(true);
      await loadPlants();
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Failed to create plant",
      );
    } finally {
      setSaving(false);
    }
  };

  const updatePlant = useCallback(
    async (
      plantId: number,
      updates: Partial<
        Pick<Plant, "watering_duration" | "watering_frequency" | "enabled">
      >,
    ) => {
      if (!token || !normalizedApiUrl) {
        return;
      }

      setUpdatingId(plantId);
      setError("");
      setSuccess("");

      try {
        const response = await fetch(
          `${normalizedApiUrl}/api/dashboard/update_plant`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              token,
              plant_id: plantId,
              ...updates,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        setSuccess(`Plant #${plantId} auto-saved.`);
        await loadPlants();
      } catch (updateError) {
        setError(
          updateError instanceof Error
            ? updateError.message
            : "Failed to update plant",
        );
      } finally {
        setUpdatingId(null);
      }
    },
    [token, normalizedApiUrl, loadPlants],
  );

  const deletePlant = useCallback(
    async (plantId: number, closeDetails = false) => {
      if (!token || !normalizedApiUrl) {
        return;
      }

      setDeletingId(plantId);
      setError("");
      setSuccess("");

      try {
        const response = await fetch(
          `${normalizedApiUrl}/api/dashboard/delete_plant`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              token,
              plant_id: plantId,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        setSuccess(`Plant #${plantId} deleted.`);
        if (closeDetails) {
          setDetailsPlantId(null);
        }
        await loadPlants();
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete plant",
        );
      } finally {
        setDeletingId(null);
      }
    },
    [token, normalizedApiUrl, loadPlants],
  );

  const addWateringOrder = useCallback(
    async (plantId: number, durationText?: string) => {
      if (!token || !normalizedApiUrl) {
        return;
      }

      const trimmedDuration = durationText?.trim() ?? "";
      let duration: number | undefined;

      if (trimmedDuration.length > 0) {
        const parsed = Number.parseInt(trimmedDuration, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          setError("Order duration must be a positive integer in seconds.");
          return;
        }

        duration = parsed;
      }

      setOrderingId(plantId);
      setError("");
      setSuccess("");

      try {
        const response = await fetch(
          `${normalizedApiUrl}/api/dashboard/add_order`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              token,
              plant_id: plantId,
              ...(duration !== undefined ? { duration } : {}),
            }),
          },
        );

        if (!response.ok) {
          throw new Error(await parseApiError(response));
        }

        setSuccess(`Watering order created for plant #${plantId}.`);
      } catch (orderError) {
        setError(
          orderError instanceof Error
            ? orderError.message
            : "Failed to create watering order",
        );
      } finally {
        setOrderingId(null);
      }
    },
    [token, normalizedApiUrl],
  );

  const deleteOrder = useCallback(
    async (orderId: number) => {
      if (!token || !normalizedApiUrl) {
        return;
      }

      const endpoints = [
        "/api/dashboard/delete_order",
        "/dashboard/delete_order",
      ];

      setDeletingOrderId(orderId);
      setError("");
      setSuccess("");

      try {
        let lastError: Error | null = null;

        for (const endpoint of endpoints) {
          try {
            const response = await fetch(`${normalizedApiUrl}${endpoint}`, {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                token,
                order_id: orderId,
              }),
            });

            if (!response.ok) {
              lastError = new Error(await parseApiError(response));
              continue;
            }

            setExpandedOrderId((current) =>
              current === orderId ? null : current,
            );
            setSuccess(`Order #${orderId} deleted.`);
            await loadOrders();
            return;
          } catch (deleteError) {
            lastError =
              deleteError instanceof Error
                ? deleteError
                : new Error("Failed to delete watering order");
          }
        }

        setError(lastError?.message ?? "Failed to delete watering order");
      } finally {
        setDeletingOrderId(null);
      }
    },
    [token, normalizedApiUrl, loadOrders],
  );

  const selectedPlant = useMemo(
    () => plants.find((plant) => plant.id === detailsPlantId) ?? null,
    [plants, detailsPlantId],
  );

  const latestConnectionLabel = useMemo(() => {
    const latestTimestamp = plants.reduce<number | null>((latest, plant) => {
      if (!plant.last_call) {
        return latest;
      }

      const parsed = Date.parse(plant.last_call);
      if (!Number.isFinite(parsed)) {
        return latest;
      }

      return latest === null || parsed > latest ? parsed : latest;
    }, null);

    if (latestTimestamp === null) {
      return "-";
    }

    return formatRelativeTimeFromNow(latestTimestamp);
  }, [plants]);

  const completedWateringPoints = useMemo<CompletedWateringPoint[]>(() => {
    return orders
      .filter((order) => order.status.toLowerCase() === "completed")
      .map((order) => {
        const timestamp = getCompletedWateringTimestamp(order);
        if (timestamp === null) {
          return null;
        }

        const duration = getCompletedWateringDuration(order);
        return {
          orderId: order.id,
          plantId: order.plant_id,
          timestamp,
          duration,
          label: new Date(timestamp).toLocaleString(),
        };
      })
      .filter((point): point is CompletedWateringPoint => point !== null)
      .sort((left, right) => left.timestamp - right.timestamp);
  }, [orders]);

  const openPlantDetails = (plantId: number) => {
    setOrderDurationInput("");
    setDetailsPlantId(plantId);
  };

  const closePlantDetails = () => {
    setDetailsPlantId(null);
    setOrderDurationInput("");
  };

  const handleCreateOrderFromDetails = async () => {
    if (!selectedPlant) {
      return;
    }

    await addWateringOrder(selectedPlant.id, orderDurationInput);
    setOrderDurationInput("");
  };

  const handleDeleteFromDetails = async () => {
    if (!selectedPlant) {
      return;
    }

    const confirmed = window.confirm(`Delete plant #${selectedPlant.id}?`);
    if (!confirmed) {
      return;
    }

    await deletePlant(selectedPlant.id, true);
  };

  const handleDeleteOrder = async (orderId: number) => {
    const confirmed = window.confirm(`Delete order #${orderId}?`);
    if (!confirmed) {
      return;
    }

    await deleteOrder(orderId);
  };

  const canLoad = Boolean(token && normalizedApiUrl);

  useEffect(() => {
    if (!canLoad) {
      return;
    }

    let isRefreshing = false;

    const refreshAll = async () => {
      if (isRefreshing) {
        return;
      }

      isRefreshing = true;
      try {
        await Promise.all([loadPlants(), loadOrders()]);
      } finally {
        isRefreshing = false;
      }
    };

    void refreshAll();

    const intervalId = setInterval(() => {
      void refreshAll();
    }, 2000);

    return () => {
      clearInterval(intervalId);
    };
  }, [canLoad, loadPlants, loadOrders]);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setSuccess("");
    }, 2200);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [success]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_15%_20%,rgba(0,255,170,0.09),transparent_35%),radial-gradient(circle_at_85%_5%,rgba(89,129,255,0.1),transparent_30%),linear-gradient(180deg,#050505_0%,#090909_45%,#030303_100%)] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 opacity-40 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-size-[42px_42px]" />
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 lg:py-12">
        <header className="rounded-3xl border border-white/10 bg-black/45 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_20px_70px_rgba(0,0,0,0.65)] backdrop-blur-lg">
          <p className="text-xs uppercase tracking-[0.28em] text-emerald-300/85">
            Smart Irrigation
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold text-white sm:text-4xl">
                Watering Control Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-zinc-300">
                Monitor all plants, create new watering schedules, and toggle
                devices in real-time.
              </p>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Plants" value={plants.length.toString()} />
          <MetricCard label="Last update" value={latestConnectionLabel} />
          <MetricCard
            label="Avg. Frequency"
            value={
              plants.length > 0
                ? `${(
                    plants.reduce(
                      (sum, plant) => sum + plant.watering_frequency,
                      0,
                    ) /
                    plants.length /
                    SECONDS_PER_DAY
                  ).toFixed(2)}d`
                : "-"
            }
          />
        </section>

        {!token && (
          <AlertCard
            tone="error"
            message="Missing token. Open this dashboard with ?token=YOUR_DEVICE_TOKEN"
          />
        )}
        {!normalizedApiUrl && (
          <AlertCard
            tone="error"
            message="Missing API_URL in .env. Add API_URL (or NEXT_PUBLIC_API_URL) and restart the app."
          />
        )}
        {error && <AlertCard tone="error" message={error} />}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1.9fr]">
          <form
            onSubmit={handleCreatePlant}
            className="rounded-2xl border border-white/10 bg-zinc-950/80 p-5 shadow-lg shadow-black/30"
          >
            <h2 className="text-lg font-semibold text-white">
              🪴 Create Plant
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Add a new schedule to your watering fleet.
            </p>

            <label
              className="mt-5 block text-xs uppercase tracking-[0.16em] text-zinc-400"
              htmlFor="duration"
            >
              Watering Duration (seconds)
            </label>
            <input
              id="duration"
              value={durationInput}
              onChange={(event) => setDurationInput(event.target.value)}
              inputMode="numeric"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none ring-0 transition placeholder:text-zinc-500 focus:border-emerald-300/60"
            />

            <label
              className="mt-4 block text-xs uppercase tracking-[0.16em] text-zinc-400"
              htmlFor="frequency"
            >
              Frequency (days)
            </label>
            <input
              id="frequency"
              type="number"
              step="0.1"
              min="0.1"
              value={frequencyInput}
              onChange={(event) => setFrequencyInput(event.target.value)}
              inputMode="decimal"
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none ring-0 transition placeholder:text-zinc-500 focus:border-emerald-300/60"
            />

            <label className="mt-4 flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={enabledInput}
                onChange={(event) => setEnabledInput(event.target.checked)}
                className="size-4 rounded border-white/20 bg-black text-emerald-300"
              />
              Enabled on creation
            </label>

            <button
              type="submit"
              disabled={saving || !canLoad}
              className="mt-6 w-full rounded-xl border border-emerald-300/35 bg-emerald-300/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Creating..." : "Create plant"}
            </button>
          </form>

          <div className="rounded-2xl border border-white/10 bg-zinc-950/80 p-5 shadow-lg shadow-black/30">
            <h2 className="text-lg font-semibold text-white">Plant Fleet</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Update duration, frequency, and status per plant.
            </p>

            <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
              <div className="grid grid-cols-[0.7fr_1fr_1fr_0.8fr_0.9fr] gap-2 bg-zinc-900/80 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
                <span>ID</span>
                <span>Duration</span>
                <span>Frequency (d)</span>
                <span>Status</span>
                <span>Details</span>
              </div>

              {plants.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-zinc-500">
                  {loading
                    ? "Loading plants..."
                    : "No plants yet. Create one to get started."}
                </div>
              ) : (
                <ul className="divide-y divide-white/5 overflow-x-auto">
                  {plants.map((plant) => (
                    <PlantRow
                      key={`${plant.id}-${plant.watering_duration}-${plant.watering_frequency}-${Number(plant.enabled)}`}
                      plant={plant}
                      disabled={
                        updatingId === plant.id ||
                        deletingId === plant.id ||
                        orderingId === plant.id
                      }
                      onAutoSave={updatePlant}
                      onOpenDetails={openPlantDetails}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-zinc-950/80 p-5 shadow-lg shadow-black/30">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Orders</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Latest watering orders from the device.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
              {orders.length} total
            </p>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-white/10">
            <div className="grid grid-cols-[0.8fr_0.8fr_1.3fr_0.8fr_0.9fr] gap-2 bg-zinc-900/80 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
              <span>ID</span>
              <span>Plant</span>
              <span>Date</span>
              <span>Duration</span>
              <span>Status</span>
            </div>

            {orders.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-zinc-500">
                {loading
                  ? "Loading orders..."
                  : "No orders found for this token."}
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {orders.map((order) => {
                  const isExpanded = expandedOrderId === order.id;
                  const isDeletingOrder = deletingOrderId === order.id;

                  return (
                    <li
                      key={`${order.id}-${order.date}`}
                      className={`px-3 py-2 text-sm ${
                        order.status.toLowerCase() === "completed"
                          ? "border-l-2 border-emerald-300/70 bg-emerald-500/16 text-emerald-100"
                          : order.status.toLowerCase() === "started"
                            ? "border-l-2 border-amber-300/80 bg-[repeating-linear-gradient(135deg,rgba(250,204,21,0.28)_0px,rgba(250,204,21,0.28)_8px,rgba(0,0,0,0.38)_8px,rgba(0,0,0,0.38)_16px)] text-amber-50"
                            : "bg-black/20 text-zinc-200"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedOrderId((current) =>
                            current === order.id ? null : order.id,
                          )
                        }
                        disabled={isDeletingOrder}
                        className="w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <div className="grid cursor-pointer grid-cols-[0.8fr_0.8fr_1.3fr_0.8fr_0.9fr] items-center gap-2">
                          <span className="font-medium text-zinc-300">
                            #{order.id}
                          </span>
                          <span className="text-zinc-200">
                            #{order.plant_id}
                          </span>
                          <span className="text-zinc-300">
                            {new Date(order.date).toLocaleString()}
                          </span>
                          <span className="text-zinc-100">
                            {order.duration}s
                          </span>
                          <span className="capitalize text-zinc-100">
                            {order.status}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mt-3 rounded-lg border border-white/12 bg-black/25 p-3">
                          <div className="grid grid-cols-1 gap-3 text-xs uppercase tracking-[0.14em] text-zinc-300 sm:grid-cols-3">
                            <div>
                              <p className="text-zinc-400">Started Date</p>
                              <p className="mt-1 text-sm normal-case tracking-normal text-zinc-100">
                                {formatDateTime(order.started_date)}
                              </p>
                            </div>
                            <div>
                              <p className="text-zinc-400">Completed Date</p>
                              <p className="mt-1 text-sm normal-case tracking-normal text-zinc-100">
                                {formatDateTime(order.completed_date)}
                              </p>
                            </div>
                            <div>
                              <p className="text-zinc-400">Actual Duration</p>
                              <p className="mt-1 text-sm normal-case tracking-normal text-zinc-100">
                                {(() => {
                                  const actualDuration =
                                    computeActualDurationSeconds(
                                      order.started_date,
                                      order.completed_date,
                                    );
                                  return actualDuration === null
                                    ? "-"
                                    : `${actualDuration}s`;
                                })()}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex justify-end">
                            <button
                              type="button"
                              onClick={() => void handleDeleteOrder(order.id)}
                              disabled={isDeletingOrder}
                              className="inline-flex items-center justify-center rounded-lg border border-rose-300/35 bg-rose-400/14 px-3 py-2 text-xs font-medium uppercase tracking-[0.16em] text-rose-100 transition hover:border-rose-300/65 hover:bg-rose-400/22 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {isDeletingOrder ? "Deleting..." : "Delete order"}
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
        <section className="rounded-2xl border border-white/10 bg-zinc-950/80 p-5 shadow-lg shadow-black/30">
          <CompletedWateringsChart points={completedWateringPoints} />
        </section>
      </main>

      {success && <SuccessToast message={success} />}
      {selectedPlant && (
        <PlantDetailsModal
          plant={selectedPlant}
          orderDurationInput={orderDurationInput}
          setOrderDurationInput={setOrderDurationInput}
          isOrdering={orderingId === selectedPlant.id}
          isDeleting={deletingId === selectedPlant.id}
          onClose={closePlantDetails}
          onCreateOrder={handleCreateOrderFromDetails}
          onDelete={handleDeleteFromDetails}
        />
      )}
    </div>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
};

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <article className="rounded-2xl border border-white/10 bg-black/35 p-4 shadow-lg shadow-black/40 backdrop-blur">
      <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </article>
  );
}

type CompletedWateringsChartProps = {
  points: CompletedWateringPoint[];
};

function CompletedWateringsChart({ points }: CompletedWateringsChartProps) {
  const plantIds = useMemo(
    () =>
      [...new Set(points.map((point) => point.plantId))].sort((a, b) => a - b),
    [points],
  );

  const plantColors = useMemo(
    () =>
      new Map(
        plantIds.map((plantId, index) => [
          plantId,
          CHART_COLORS[index % CHART_COLORS.length],
        ]),
      ),
    [plantIds],
  );

  const chartModel = useMemo(() => {
    if (points.length === 0 || plantIds.length === 0) {
      return null;
    }

    const width = 960;
    const height = 360;
    const margin = { top: 24, right: 20, bottom: 54, left: 72 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const timestamps = points.map((point) => point.timestamp);
    const durations = points.map((point) => point.duration);
    const dayTimestamps = timestamps.map((timestamp) =>
      getStartOfDayTimestamp(timestamp),
    );
    const minDayTimestamp = Math.min(...dayTimestamps);
    const maxDayTimestamp = Math.max(...dayTimestamps);
    const minDuration = Math.min(...durations);
    const maxDuration = Math.max(...durations);
    const minMinutes = 0;
    const maxMinutes = 24 * 60;

    const getX = (timestamp: number) => {
      const dayTimestamp = getStartOfDayTimestamp(timestamp);

      if (minDayTimestamp === maxDayTimestamp) {
        return margin.left + innerWidth / 2;
      }

      return (
        margin.left +
        ((dayTimestamp - minDayTimestamp) /
          (maxDayTimestamp - minDayTimestamp)) *
          innerWidth
      );
    };

    const getY = (timestamp: number) => {
      const minutes = getMinutesSinceMidnight(timestamp);
      return (
        margin.top +
        innerHeight -
        ((minutes - minMinutes) / (maxMinutes - minMinutes)) * innerHeight
      );
    };

    const getRadius = (duration: number) => {
      if (minDuration === maxDuration) {
        return 9;
      }

      return 5 + ((duration - minDuration) / (maxDuration - minDuration)) * 11;
    };

    const xTickCount = Math.min(5, points.length);
    const xTicks = Array.from({ length: xTickCount }, (_, index) => {
      const ratio = xTickCount === 1 ? 0.5 : index / (xTickCount - 1);
      const timestamp =
        minDayTimestamp +
        Math.round((maxDayTimestamp - minDayTimestamp) * ratio);
      return {
        x: getX(timestamp),
        label: new Date(timestamp).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      };
    });

    const yTickMinutes = [0, 360, 720, 1_080, 1_439];
    const yTicks = yTickMinutes.map((minutes) => ({
      minutes,
      y: getY(minDayTimestamp + minutes * 60_000),
      label: formatTimeOfDay(minutes),
    }));

    const circles = points.map((point) => ({
      ...point,
      x: getX(point.timestamp),
      y: getY(point.timestamp),
      radius: getRadius(point.duration),
      color: plantColors.get(point.plantId) ?? "#f5f5f5",
    }));

    return {
      width,
      height,
      margin,
      xTicks,
      yTicks,
      circles,
      minDuration,
      maxDuration,
    };
  }, [plantColors, plantIds, points]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Completed Waterings
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Every completed watering plotted over time. Bubble size increases
            with duration.
          </p>
        </div>
        <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
          {points.length} completed
        </p>
      </div>

      {chartModel === null ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-zinc-500">
          No completed watering data available yet.
        </div>
      ) : (
        <>
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] p-3">
            <svg
              viewBox={`0 0 ${chartModel.width} ${chartModel.height}`}
              className="h-auto w-full"
              role="img"
              aria-label="Completed watering scatter plot"
            >
              <defs>
                <linearGradient
                  id="completedWateringsArea"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="rgba(52,211,153,0.08)" />
                  <stop offset="100%" stopColor="rgba(255,255,255,0.01)" />
                </linearGradient>
              </defs>

              <rect
                x={chartModel.margin.left}
                y={chartModel.margin.top}
                width={
                  chartModel.width -
                  chartModel.margin.left -
                  chartModel.margin.right
                }
                height={
                  chartModel.height -
                  chartModel.margin.top -
                  chartModel.margin.bottom
                }
                fill="url(#completedWateringsArea)"
              />

              {chartModel.yTicks.map((tick) => (
                <g key={tick.minutes}>
                  <line
                    x1={chartModel.margin.left}
                    y1={tick.y}
                    x2={chartModel.width - chartModel.margin.right}
                    y2={tick.y}
                    stroke="rgba(255,255,255,0.08)"
                    strokeDasharray="4 8"
                  />
                  <text
                    x={chartModel.margin.left - 14}
                    y={tick.y + 5}
                    textAnchor="end"
                    fill="rgba(228,228,231,0.8)"
                    fontSize="13"
                    fontWeight="600"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {chartModel.xTicks.map((tick, index) => (
                <g key={`${tick.label}-${index}`}>
                  <line
                    x1={tick.x}
                    y1={chartModel.margin.top}
                    x2={tick.x}
                    y2={chartModel.height - chartModel.margin.bottom}
                    stroke="rgba(255,255,255,0.06)"
                  />
                  <text
                    x={tick.x}
                    y={chartModel.height - 18}
                    textAnchor="middle"
                    fill="rgba(228,228,231,0.8)"
                    fontSize="12"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              <line
                x1={chartModel.margin.left}
                y1={chartModel.height - chartModel.margin.bottom}
                x2={chartModel.width - chartModel.margin.right}
                y2={chartModel.height - chartModel.margin.bottom}
                stroke="rgba(255,255,255,0.18)"
              />

              <line
                x1={chartModel.margin.left}
                y1={chartModel.margin.top}
                x2={chartModel.margin.left}
                y2={chartModel.height - chartModel.margin.bottom}
                stroke="rgba(255,255,255,0.18)"
              />

              {chartModel.circles.map((circle) => (
                <g key={circle.orderId}>
                  <circle
                    cx={circle.x}
                    cy={circle.y}
                    r={circle.radius + 4}
                    fill={circle.color}
                    opacity="0.15"
                  />
                  <circle
                    cx={circle.x}
                    cy={circle.y}
                    r={circle.radius}
                    fill={circle.color}
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth="1.5"
                    opacity="0.9"
                  >
                    <title>
                      {`Plant #${circle.plantId} • ${circle.duration}s • ${circle.label}`}
                    </title>
                  </circle>
                </g>
              ))}

              <text
                x={chartModel.width / 2}
                y={chartModel.height - 2}
                textAnchor="middle"
                fill="rgba(161,161,170,0.75)"
                fontSize="12"
                letterSpacing="0.16em"
              >
                DATE
              </text>
              <text
                x={18}
                y={chartModel.height / 2}
                textAnchor="middle"
                fill="rgba(161,161,170,0.75)"
                fontSize="12"
                letterSpacing="0.16em"
                transform={`rotate(-90 18 ${chartModel.height / 2})`}
              >
                TIME
              </text>
            </svg>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-zinc-300">
            {plantIds.map((plantId) => (
              <span
                key={plantId}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: plantColors.get(plantId) }}
                />
                {`Plant #${plantId}`}
              </span>
            ))}
          </div>

          <p className="mt-3 text-xs text-zinc-500">
            Duration scale: {chartModel.minDuration}s to{" "}
            {chartModel.maxDuration}s.
          </p>
        </>
      )}
    </>
  );
}

type AlertCardProps = {
  tone: "error" | "success";
  message: string;
};

function AlertCard({ tone, message }: AlertCardProps) {
  const style =
    tone === "error"
      ? "border-rose-300/35 bg-rose-400/10 text-rose-100"
      : "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${style}`}>
      {message}
    </div>
  );
}

type PlantRowProps = {
  plant: Plant;
  disabled: boolean;
  onAutoSave: (
    plantId: number,
    updates: Partial<
      Pick<Plant, "watering_duration" | "watering_frequency" | "enabled">
    >,
  ) => void;
  onOpenDetails: (plantId: number) => void;
};

function PlantRow({
  plant,
  disabled,
  onAutoSave,
  onOpenDetails,
}: PlantRowProps) {
  const [duration, setDuration] = useState(String(plant.watering_duration));
  const [frequencyDays, setFrequencyDays] = useState(
    secondsToDays(plant.watering_frequency),
  );
  const [enabled, setEnabled] = useState(plant.enabled);
  const lastSavedRef = useRef({
    watering_duration: plant.watering_duration,
    watering_frequency: plant.watering_frequency,
    enabled: plant.enabled,
  });

  useEffect(() => {
    if (disabled) {
      return;
    }

    const wateringDuration = Number.parseInt(duration, 10);
    const wateringFrequency = daysToSeconds(frequencyDays);

    if (!Number.isInteger(wateringDuration) || wateringDuration <= 0) {
      return;
    }

    if (!Number.isInteger(wateringFrequency) || wateringFrequency <= 0) {
      return;
    }

    const pendingUpdate = {
      watering_duration: wateringDuration,
      watering_frequency: wateringFrequency,
      enabled,
    };

    if (
      pendingUpdate.watering_duration ===
        lastSavedRef.current.watering_duration &&
      pendingUpdate.watering_frequency ===
        lastSavedRef.current.watering_frequency &&
      pendingUpdate.enabled === lastSavedRef.current.enabled
    ) {
      return;
    }

    const timeoutId = setTimeout(() => {
      onAutoSave(plant.id, pendingUpdate);
    }, 700);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [duration, frequencyDays, enabled, disabled, plant.id, onAutoSave]);

  const hasNoConnection = !plant.last_call;
  const isLastCallStale = Boolean(plant.is_last_call_stale);
  const emojiList = [
    "🪻",
    "🌱",
    "🌿",
    "🪴",
    "🌺",
    "🍀",
    "🍃",
    "🌳",
    "🌵",
    "🌼",
    "🌾",
    "🌴",
  ];
  const plantEmoji = isLastCallStale
    ? "🍂"
    : emojiList[plant.id % emojiList.length];

  const rowClassName = hasNoConnection
    ? "grid grid-cols-[0.7fr_1fr_1fr_0.8fr_0.9fr] items-center gap-2 border-l-2 border-zinc-500/60 bg-zinc-700/20 px-3 py-2 text-sm text-zinc-400"
    : isLastCallStale
      ? "grid grid-cols-[0.7fr_1fr_1fr_0.8fr_0.9fr] items-center gap-2 border-l-2 border-rose-400/70 bg-rose-500/15 px-3 py-2 text-sm text-rose-100"
      : "grid grid-cols-[0.7fr_1fr_1fr_0.8fr_0.9fr] items-center gap-2 bg-black/20 px-3 py-2 text-sm text-zinc-200";

  return (
    <li className={rowClassName}>
      <span className="font-medium text-zinc-300">
        {plantEmoji} #{plant.id}
      </span>
      <input
        value={duration}
        onChange={(event) => setDuration(event.target.value)}
        disabled={disabled}
        inputMode="numeric"
        className="rounded-lg w-25 border border-white/10 bg-zinc-900/90 px-2 py-1 text-sm outline-none transition focus:border-emerald-300/60 disabled:opacity-50"
      />
      <input
        type="number"
        step="0.1"
        min="0.1"
        value={frequencyDays}
        onChange={(event) => setFrequencyDays(event.target.value)}
        disabled={disabled}
        inputMode="decimal"
        className="rounded-lg w-25 border border-white/10 bg-zinc-900/90 px-2 py-1 text-sm outline-none transition focus:border-emerald-300/60 disabled:opacity-50"
      />
      <label className="inline-flex items-center gap-2 text-xs text-zinc-300">
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-4 rounded border-white/20 bg-black text-emerald-300 disabled:opacity-60"
        />
        {enabled ? "On" : "Off"}
      </label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenDetails(plant.id)}
        aria-label={`Open details for plant ${plant.id}`}
        title={`Open details for plant ${plant.id}`}
        className="rounded-lg border border-white/20 bg-white/8 px-2 py-1 text-xs font-medium text-zinc-100 transition hover:border-emerald-300/60 hover:bg-emerald-400/12 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Details
      </button>
    </li>
  );
}

type PlantDetailsModalProps = {
  plant: Plant;
  orderDurationInput: string;
  setOrderDurationInput: (value: string) => void;
  isOrdering: boolean;
  isDeleting: boolean;
  onClose: () => void;
  onCreateOrder: () => void;
  onDelete: () => void;
};

function PlantDetailsModal({
  plant,
  orderDurationInput,
  setOrderDurationInput,
  isOrdering,
  isDeleting,
  onClose,
  onCreateOrder,
  onDelete,
}: PlantDetailsModalProps) {
  const isBusy = isOrdering || isDeleting;
  const lastConnectionLabel = useMemo(() => {
    if (!plant.last_call) {
      return "No connection yet";
    }

    const lastConnectionTime = Date.parse(plant.last_call);
    if (!Number.isFinite(lastConnectionTime)) {
      return "Invalid date";
    }

    return new Date(lastConnectionTime).toLocaleString();
  }, [plant.last_call]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        onClick={onClose}
      />
      <section className="relative z-10 w-full max-w-3xl rounded-3xl border border-white/12 bg-zinc-950/95 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] overflow-y-auto max-h-[90dvh]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-400">
              Plant Details
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">
              Plant #{plant.id}
            </h3>
            <p className="mt-2 text-sm text-zinc-300">
              Manage manual watering orders or remove this plant.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 bg-white/5 px-3 py-1.5 text-sm text-zinc-200 transition hover:border-white/40 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
              Duration
            </p>
            <p className="mt-2 text-lg font-medium text-white">
              {plant.watering_duration}s
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
              Frequency
            </p>
            <p className="mt-2 text-lg font-medium text-white">
              {secondsToDays(plant.watering_frequency)}d
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
              Status
            </p>
            <p className="mt-2 text-lg font-medium text-white">
              {plant.enabled ? "Enabled" : "Disabled"}
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-black/30 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-400">
              Last Connection
            </p>
            <p className="mt-2 text-sm font-medium text-white">
              {lastConnectionLabel}
            </p>
          </article>
        </div>

        <div className="mt-6 rounded-2xl border border-cyan-300/25 bg-cyan-400/7 p-4">
          <h4 className="text-sm font-semibold text-cyan-100">
            Create Watering Order
          </h4>
          <p className="mt-1 text-sm text-zinc-300">
            Optional custom duration in seconds. Leave empty to use plant
            default.
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              value={orderDurationInput}
              onChange={(event) => setOrderDurationInput(event.target.value)}
              inputMode="numeric"
              placeholder="Optional duration (seconds)"
              disabled={isBusy}
              className="w-full rounded-xl border border-white/12 bg-black/35 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-500 focus:border-cyan-300/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={onCreateOrder}
              disabled={isBusy}
              className="rounded-xl border border-cyan-300/30 bg-cyan-400/12 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-300/65 hover:bg-cyan-400/22 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isOrdering ? "Creating..." : "Create order"}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-rose-300/25 bg-rose-400/7 p-4">
          <h4 className="text-sm font-semibold text-rose-100">Danger Zone</h4>
          <p className="mt-1 text-sm text-zinc-300">
            Deleting a plant also deletes related logs, orders, and calls.
          </p>
          <button
            type="button"
            onClick={onDelete}
            disabled={isBusy}
            className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300/35 bg-rose-400/14 px-4 py-2 text-sm font-medium text-rose-100 transition hover:border-rose-300/65 hover:bg-rose-400/22 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isDeleting ? "Deleting..." : "Delete plant"}
          </button>
        </div>
      </section>
    </div>
  );
}

type SuccessToastProps = {
  message: string;
};

function SuccessToast({ message }: SuccessToastProps) {
  return (
    <div className="fixed bottom-4 right-4 z-50 rounded-xl border border-emerald-300/45 bg-emerald-400/20 px-4 py-3 text-sm font-medium text-emerald-100 shadow-[0_12px_38px_rgba(0,0,0,0.5)] backdrop-blur-md">
      {message}
    </div>
  );
}
