/**
 * Free Model Selector — shows ranked free models and lets you pick one,
 * plus registers a virtual model "openrouter/free" that auto-selects the
 * best free model for each request.
 *
 * Place in: .pi/agent/extensions/free-model-selector.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/models";

interface ModelInfo {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  benchmarks?: {
    artificial_analysis?: {
      coding_index?: number;
      intelligence_index?: number;
      agentic_index?: number;
    };
  };
  created?: number;
  expiration_date?: string;
}

// ── Scoring helpers (shared with openrouter-free-model-picker) ───────────

function getIdx(m: ModelInfo, key: string): number {
  const ba = m.benchmarks?.artificial_analysis;
  if (!ba) return -1;
  const raw = (ba as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : -1;
}

function scoreModel(m: ModelInfo, apiRank: number): number {
  const baseScore = Math.max(10 - apiRank, 0);

  const codingIdx = getIdx(m, "coding_index");
  const intIdx = getIdx(m, "intelligence_index");
  const agenticIdx = getIdx(m, "agentic_index");

  let qualityScore = 0;
  if (codingIdx >= 0 && intIdx >= 0 && agenticIdx >= 0) {
    qualityScore += Math.min(codingIdx / 100, 1) * 35;
    qualityScore += Math.min(intIdx / 100, 1) * 30;
    qualityScore += Math.min(agenticIdx / 100, 1) * 35;
  }

  return baseScore + qualityScore;
}

async function fetchFreeModels(): Promise<ModelInfo[]> {
  const params = new URLSearchParams({
    max_price: "0",
    max_output_price: "0",
    sort: "most-popular",
    input_modalities: "text",
    limit: "40",
  });

  const res = await fetch(OPENROUTER_API_URL + "?" + params.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) throw new Error(`API error ${res.status}`);

  const json = await res.json();
  const models: ModelInfo[] = json.data;

  // Filter free models
  const freeModels = models.filter(
    (m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0",
  );

  if (freeModels.length === 0) return [];

  // Score & rank
  freeModels.forEach((m, i) => {
    (m as Record<string, unknown>).score = scoreModel(m, i);
  });

  freeModels.sort(
    (a, b) =>
      ((b as Record<string, unknown>).score as number) -
      ((a as Record<string, unknown>).score as number),
  );

  return freeModels;
}

// ── Format helpers ──────────────────────────────────────────────────────

function fmtCtx(ctx?: number): string {
  if (!ctx) return "—";
  if (ctx >= 1_000_000) return `${Math.round(ctx / 1_000_000)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`;
  return String(ctx);
}

function fmtDate(val: string | number | undefined): string {
  if (!val) return "—";
  let d: Date;
  if (typeof val === "number") {
    d = new Date(val * 1000);
  } else {
    d = new Date(val + "T00:00:00Z");
  }
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function idx(val: number): string {
  return val >= 0 ? String(Math.round(val)) : "—";
}

// ── Virtual model state ─────────────────────────────────────────────────

interface RouterState {
  /** Cached free model list (fetched once per session) */
  freeModels: ModelInfo[];
  /** Timestamp of the last fetch */
  fetchedAt: number;
}

// Cache TTL: 10 minutes
const CACHE_TTL_MS = 10 * 60 * 1000;

export default function (pi: ExtensionAPI) {
  // Fetch free models once at startup and cache them
  let cachedState: RouterState | null = null;

  async function getCachedFreeModels(): Promise<ModelInfo[]> {
    if (cachedState && Date.now() - cachedState.fetchedAt < CACHE_TTL_MS) {
      return cachedState.freeModels;
    }

    const models = await fetchFreeModels();
    cachedState = { freeModels: models, fetchedAt: Date.now() };
    return models;
  }

  // ── Register virtual model "openrouter/free" ──────────────────────────

  pi.registerVirtualModel({
    provider: "openrouter",
    id: "free",
    name: "OpenRouter Free",
    thinkingLevels: ["off"] as const,
    input: ["text"] as const,
    contextWindow: 128_000,
    maxTokens: 8192,

    route: async (_request, ctx) => {
      // Try to resolve the best free model from the cached/fetched list
      const freeModels = await getCachedFreeModels();

      if (freeModels.length === 0) {
        // Fallback: try to find any configured model
        const allModels = ctx.modelRegistry.getAll();
        const fallback = allModels[0];
        if (fallback) {
          return { model: fallback, thinkingLevel: "off" };
        }
        return { model: _request.model, thinkingLevel: "off" };
      }

      // Pick the top-ranked free model
      const best = freeModels[0] as ModelInfo;
      const resolved = ctx.modelRegistry.find("openrouter", best.id);

      if (resolved) {
        return { model: resolved, thinkingLevel: "off" };
      }

      // If not in registry, fall back to current model
      return { model: _request.model, thinkingLevel: "off" };
    },
  });

  // ── Manual selector command ───────────────────────────────────────────

  pi.registerCommand("free-model-select", {
    description:
      "Show ranked free models and let you pick one to use for this session",
    handler: async (_args: string, ctx) => {
      // Guard: UI-only command
      if (!ctx.hasUI) {
        ctx.ui.notify("This command requires interactive UI.", "error");
        return;
      }

      // Fetch & rank free models
      const freeModels = await fetchFreeModels();

      if (freeModels.length === 0) {
        ctx.ui.notify("📭 No free models found on OpenRouter.", "info");
        return;
      }

      // Build formatted table (top 15)
      const top = freeModels.slice(0, 15);
      const padId = Math.max(...top.map((m) => String(m.id ?? "").length));

      const lines = [
        `${"#".padEnd(4)} ${"Model".padEnd(padId + 2)} Ctx  Cod Int Agt Created  Expires  In:Out`,
        `${"-".repeat(padId + 70)}`,
      ];

      top.forEach((m, i) => {
        const arch = m.architecture as {
          input_modalities?: string[];
          output_modalities?: string[];
        } | undefined;
        const inMod = (arch?.input_modalities ?? []).join("/") || "—";
        const outMod = (arch?.output_modalities ?? []).join("/") || "—";
        const ioMod = `${inMod}:${outMod}`;
        const codingIdx = getIdx(m, "coding_index");
        const intIdx = getIdx(m, "intelligence_index");
        const agenticIdx = getIdx(m, "agentic_index");

        lines.push(
          `${String(i + 1).padEnd(4)} ${String(m.id).padEnd(padId + 2)} ${fmtCtx(m.context_length).padEnd(4)} ${idx(codingIdx).padEnd(3)} ${idx(intIdx).padEnd(3)} ${idx(agenticIdx).padEnd(3)} ${fmtDate(m.created) ?? "—".padEnd(8)} ${(m.expiration_date?.replace(/-/g, "") ?? "—").padEnd(8)} ${ioMod}`,
        );
      });

      // Show the list first
      ctx.ui.notify(lines.join("\n"), "info");

      // Build select options: "0. openrouter/free" first, then numbered models
      const options = ["0. openrouter/free", ...top.map((m, i) => `${i + 1}. ${m.id}`)];

      // Use ctx.ui.select() — returns the selected option string or undefined
      const selectedOption = await ctx.ui.select(
        "Pick a free model:",
        options,
      );

      if (selectedOption == null) {
        ctx.ui.notify("No model selected.", "info");
        return;
      }

      // Parse the selected model ID from the option string ("N. model-id")
      const selectedId = selectedOption.replace(/^\d+\.\s*/, "");

      // Handle "0. openrouter/free" — switch to the virtual model
      if (selectedId === "openrouter/free") {
        const resolvedModel = ctx.modelRegistry.find("openrouter", "free");
        if (resolvedModel) {
          const success = await pi.setModel(resolvedModel);
          if (success) {
            ctx.ui.notify(`✅ Switched to: openrouter/free`, "info");
          } else {
            ctx.ui.notify(
              `⚠️ Could not activate "openrouter/free" — it may need an API key or may not be available in your config.`,
              "warning",
            );
          }
        } else {
          ctx.ui.notify(
            `⚠️ Virtual model "openrouter/free" not found in Pi's model registry. Make sure OpenRouter is configured as a provider in your Pi settings.`,
            "warning",
          );
        }
        return;
      }

      const selected = top.find((m) => m.id === selectedId);

      if (!selected) {
        ctx.ui.notify("⚠️ Invalid selection.", "error");
        return;
      }

      // Try to resolve the model in Pi's registry and switch to it
      const resolvedModel = ctx.modelRegistry.find("openrouter", selectedId);

      if (resolvedModel) {
        const success = await pi.setModel(resolvedModel);
        if (success) {
          ctx.ui.notify(`✅ Switched to: ${selected.id}`, "info");
        } else {
          ctx.ui.notify(
            `⚠️ Could not activate "${selected.id}" — it may need an API key or may not be available in your config.`,
            "warning",
          );
        }
      } else {
        ctx.ui.notify(
          `⚠️ Model "${selected.id}" not found in Pi's model registry. Make sure OpenRouter is configured as a provider in your Pi settings.`,
          "warning",
        );
      }
    },
  });
}
