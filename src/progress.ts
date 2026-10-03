import { STAGES, type Mode } from "./course";
export interface Progress {
  version: 2;
  stars: number[];
  bestRank: number;
  endlessDistance: number;
  endlessRank: number;
  mode: Mode;
  stage: number;
  sound: boolean;
  volume: number;
  eyes: boolean;
  reducedMotion: boolean;
}
export function cleanProgress(value: unknown, reducedMotion = false): Progress {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const finite = (key: string, defaultValue: number, max: number) =>
    typeof data[key] === "number" && Number.isFinite(data[key])
      ? Math.max(0, Math.min(max, data[key] as number))
      : defaultValue;
  const stars = STAGES.map((_, i) =>
    Array.isArray(data.stars) && Number.isInteger(data.stars[i])
      ? Math.max(0, Math.min(3, data.stars[i]))
      : 0,
  );
  const stage = Math.floor(finite("stage", 0, STAGES.length - 1));
  return {
    version: 2,
    stars,
    bestRank: Math.floor(finite("bestRank", 4, 1000000)),
    endlessDistance: finite("endlessDistance", 0, 1e12),
    endlessRank: Math.floor(finite("endlessRank", 4, 1000000)),
    mode: data.mode === "endless" ? "endless" : "normal",
    stage: stage === 0 || stars[stage - 1] > 0 ? stage : 0,
    sound: typeof data.sound === "boolean" ? data.sound : true,
    volume: finite("volume", 0.65, 1),
    eyes: data.eyes === true,
    reducedMotion:
      typeof data.reducedMotion === "boolean"
        ? data.reducedMotion
        : reducedMotion,
  };
}
export function loadProgress(): Progress {
  try {
    const saved = localStorage.getItem("ball-run-2048-v2");
    if (saved)
      return cleanProgress(
        JSON.parse(saved),
        matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    const old = JSON.parse(localStorage.getItem("ball-run-2048") ?? "{}");
    return cleanProgress({
      bestRank:
        typeof old.best === "number" && old.best > 0 ? Math.log2(old.best) : 4,
      eyes: old.eyes,
      reducedMotion: old.reducedMotion,
    });
  } catch {
    return cleanProgress(
      null,
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    );
  }
}
export function saveProgress(progress: Progress) {
  try {
    localStorage.setItem("ball-run-2048-v2", JSON.stringify(progress));
  } catch {
    /* Play remains available when browser storage is disabled. */
  }
}
export function unlocked(progress: Progress, index: number) {
  return index === 0 || progress.stars[index - 1] > 0;
}
