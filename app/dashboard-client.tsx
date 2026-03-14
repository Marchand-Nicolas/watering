"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Plant = {
  id: number;
  watering_duration: number;
  enabled: boolean;
  watering_frequency: number;
};

type ApiError = {
  error?: string;
  message?: string;
};

type DashboardClientProps = {
  apiUrl: string;
};

export default function DashboardClient({ apiUrl }: DashboardClientProps) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token")?.trim() ?? "";

  const [plants, setPlants] = useState<Plant[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [durationInput, setDurationInput] = useState("15");
  const [frequencyInput, setFrequencyInput] = useState("24");
  const [enabledInput, setEnabledInput] = useState(true);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

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
      setPlants(data.plants ?? []);
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

  const handleCreatePlant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const duration = Number.parseInt(durationInput, 10);
    const frequency = Number.parseInt(frequencyInput, 10);

    if (!Number.isInteger(duration) || duration <= 0) {
      setError("Watering duration must be a positive integer.");
      return;
    }

    if (!Number.isInteger(frequency) || frequency <= 0) {
      setError("Watering frequency must be a positive integer.");
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
            watering_frequency: frequency,
            enabled: enabledInput,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      setSuccess("Plant created successfully.");
      setDurationInput("15");
      setFrequencyInput("24");
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

  const updatePlant = async (
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

      setSuccess(`Plant #${plantId} updated.`);
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
  };

  const handleManualRefresh = async () => {
    setSuccess("");
    await loadPlants();
  };

  const canLoad = Boolean(token && normalizedApiUrl);

  useEffect(() => {
    if (!canLoad) {
      return;
    }

    void loadPlants();
  }, [canLoad, loadPlants]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_15%_20%,rgba(0,255,170,0.09),transparent_35%),radial-gradient(circle_at_85%_5%,rgba(89,129,255,0.1),transparent_30%),linear-gradient(180deg,#050505_0%,#090909_45%,#030303_100%)] text-zinc-100">
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] [background-size:42px_42px]" />
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
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={!canLoad || loading}
              className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-emerald-300/60 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? "Refreshing..." : "Refresh plants"}
            </button>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard label="Plants" value={plants.length.toString()} />
          <MetricCard
            label="Enabled"
            value={plants.filter((plant) => plant.enabled).length.toString()}
          />
          <MetricCard
            label="Avg. Frequency"
            value={
              plants.length > 0
                ? `${Math.round(
                    plants.reduce(
                      (sum, plant) => sum + plant.watering_frequency,
                      0,
                    ) / plants.length,
                  )}h`
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
        {success && <AlertCard tone="success" message={success} />}

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1.9fr]">
          <form
            onSubmit={handleCreatePlant}
            className="rounded-2xl border border-white/10 bg-zinc-950/80 p-5 shadow-lg shadow-black/30"
          >
            <h2 className="text-lg font-semibold text-white">Create Plant</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Add a new schedule to your watering fleet.
            </p>

            <label
              className="mt-5 block text-xs uppercase tracking-[0.16em] text-zinc-400"
              htmlFor="duration"
            >
              Watering Duration (minutes)
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
              Frequency (hours)
            </label>
            <input
              id="frequency"
              value={frequencyInput}
              onChange={(event) => setFrequencyInput(event.target.value)}
              inputMode="numeric"
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
              <div className="grid grid-cols-[0.6fr_1fr_1fr_0.8fr_0.8fr] gap-2 bg-zinc-900/80 px-3 py-2 text-xs uppercase tracking-[0.16em] text-zinc-400">
                <span>ID</span>
                <span>Duration</span>
                <span>Frequency</span>
                <span>Status</span>
                <span>Action</span>
              </div>

              {plants.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-zinc-500">
                  {loading
                    ? "Loading plants..."
                    : "No plants yet. Create one to get started."}
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {plants.map((plant) => (
                    <PlantRow
                      key={plant.id}
                      plant={plant}
                      disabled={updatingId === plant.id}
                      onSave={(updates) => updatePlant(plant.id, updates)}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      </main>
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
  onSave: (
    updates: Partial<
      Pick<Plant, "watering_duration" | "watering_frequency" | "enabled">
    >,
  ) => void;
};

function PlantRow({ plant, disabled, onSave }: PlantRowProps) {
  const [duration, setDuration] = useState(String(plant.watering_duration));
  const [frequency, setFrequency] = useState(String(plant.watering_frequency));
  const [enabled, setEnabled] = useState(plant.enabled);

  const saveRow = () => {
    const wateringDuration = Number.parseInt(duration, 10);
    const wateringFrequency = Number.parseInt(frequency, 10);

    if (!Number.isInteger(wateringDuration) || wateringDuration <= 0) {
      return;
    }

    if (!Number.isInteger(wateringFrequency) || wateringFrequency <= 0) {
      return;
    }

    onSave({
      watering_duration: wateringDuration,
      watering_frequency: wateringFrequency,
      enabled,
    });
  };

  return (
    <li className="grid grid-cols-[0.6fr_1fr_1fr_0.8fr_0.8fr] items-center gap-2 bg-black/20 px-3 py-2 text-sm text-zinc-200">
      <span className="font-medium text-zinc-300">#{plant.id}</span>
      <input
        value={duration}
        onChange={(event) => setDuration(event.target.value)}
        disabled={disabled}
        inputMode="numeric"
        className="rounded-lg border border-white/10 bg-zinc-900/90 px-2 py-1 text-sm outline-none transition focus:border-emerald-300/60 disabled:opacity-50"
      />
      <input
        value={frequency}
        onChange={(event) => setFrequency(event.target.value)}
        disabled={disabled}
        inputMode="numeric"
        className="rounded-lg border border-white/10 bg-zinc-900/90 px-2 py-1 text-sm outline-none transition focus:border-emerald-300/60 disabled:opacity-50"
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
        onClick={saveRow}
        disabled={disabled}
        className="rounded-lg border border-emerald-300/30 bg-emerald-300/10 px-2 py-1 text-xs font-medium text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {disabled ? "Saving" : "Save"}
      </button>
    </li>
  );
}
