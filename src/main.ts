import "./style.css";
import { STAGES, formatRank, colorOfRank, type Mode } from "./course";
import { Physics } from "./physics";
import { Simulation, STEERING_LIMIT, type GameEvent } from "./simulation";
import { GameView } from "./render";
import { GameAudio } from "./audio";
import { loadProgress, saveProgress, unlocked } from "./progress";
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const audio = new GameAudio(),
  progress = loadProgress();
let sim: Simulation, view: GameView;
let mode: Mode = progress.mode,
  selectedStage = progress.stage,
  settingsPaused = false,
  finished = false,
  toastUntil = 0,
  lastTime = 0,
  hintUntil = 0;
const keys = new Set<string>();
let pointer: { id: number; x: number; target: number } | null = null;
function releaseInput() {
  keys.clear();
  pointer = null;
}
function persist() {
  progress.mode = mode;
  progress.stage = selectedStage;
  progress.sound = audio.enabled;
  progress.volume = audio.volume;
  saveProgress(progress);
}
function updateSound() {
  el("sound").setAttribute("aria-pressed", String(audio.enabled));
  el("sound").setAttribute(
    "aria-label",
    audio.enabled ? "소리 끄기" : "소리 켜기",
  );
  el("sound").style.opacity = audio.enabled ? "1" : ".55";
  el<HTMLInputElement>("effects").checked = audio.enabled;
}
function toast(text: string) {
  el("toast").textContent = text;
  el("toast").classList.add("show");
  toastUntil = performance.now() + 1150;
}
function record() {
  progress.bestRank = Math.max(progress.bestRank, sim.peakRank);
  if (sim.mode === "endless") {
    progress.endlessDistance = Math.max(progress.endlessDistance, sim.distance);
    progress.endlessRank = Math.max(progress.endlessRank, sim.peakRank);
  }
  if (sim.phase === "won")
    progress.stars[sim.stageIndex] = Math.max(
      progress.stars[sim.stageIndex],
      sim.stars,
    );
  persist();
}
function stageGrid() {
  const buttons = STAGES.map((stage, index) => {
    const button = document.createElement("button");
    button.className = "stage-card";
    button.disabled = !unlocked(progress, index);
    button.setAttribute(
      "aria-label",
      `${index + 1} 스테이지 ${stage.name}${button.disabled ? " 잠김" : ""}`,
    );
    button.setAttribute("aria-pressed", String(index === selectedStage));
    button.style.setProperty("--stage-color", stage.rail);
    const number = document.createElement("span");
    number.className = "stage-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("b");
    title.textContent = stage.name;
    const stars = document.createElement("small");
    stars.textContent = button.disabled
      ? "앞 스테이지 완료 후 열림"
      : "★".repeat(progress.stars[index]) +
        "☆".repeat(3 - progress.stars[index]);
    button.append(number, title, stars);
    button.addEventListener("click", () => {
      selectedStage = index;
      el<HTMLDialogElement>("stages").close();
      reset();
      audio.play("click");
      persist();
    });
    return button;
  });
  el("stage-grid").replaceChildren(...buttons);
}
function updateMenu() {
  el("normal-mode").setAttribute("aria-pressed", String(mode === "normal"));
  el("endless-mode").setAttribute("aria-pressed", String(mode === "endless"));
  el("stage-select").hidden = mode === "endless";
  el("selected-stage-number").textContent =
    `STAGE ${String(selectedStage + 1).padStart(2, "0")}`;
  el("selected-stage-name").textContent = STAGES[selectedStage].name;
  el("mode-description").textContent =
    mode === "normal"
      ? STAGES[selectedStage].subtitle
      : `끝없이 이어지는 코스 · 최고 ${Math.floor(progress.endlessDistance)} m`;
  el("best-label").textContent = mode === "normal" ? "BEST" : "BEST RUN";
  el("best").textContent =
    mode === "normal"
      ? formatRank(progress.bestRank)
      : `${Math.floor(progress.endlessDistance)} m`;
  el("goal-label").textContent = mode === "normal" ? "목표" : "최고 숫자";
  el("goal").textContent = formatRank(
    mode === "normal" ? STAGES[selectedStage].goalRank : progress.endlessRank,
  );
  const label = document.createElement("b");
  label.textContent =
    mode === "normal"
      ? `STAGE ${String(selectedStage + 1).padStart(2, "0")}`
      : "∞ ENDLESS";
  const name = document.createElement("span");
  name.className = "stage-name";
  name.textContent =
    mode === "normal" ? ` / ${STAGES[selectedStage].name}` : " / 끝없이 굴리기";
  el("stage").replaceChildren(label, name);
  stageGrid();
}
function reset(start = false) {
  releaseInput();
  settingsPaused = false;
  for (const id of ["result", "paused", "settings", "stages"])
    el<HTMLDialogElement>(id).close();
  sim.reset(mode, mode === "endless" ? 0 : selectedStage);
  view.reset(sim);
  view.setEyes(progress.eyes);
  view.reducedMotion = progress.reducedMotion;
  finished = false;
  el("intro").hidden = start;
  el("playing-hint").hidden = !start;
  el("run-stats").hidden = !start;
  el<HTMLButtonElement>("pause").disabled = !start;
  el("toast").classList.remove("show");
  el("toast").textContent = "";
  el("progress").style.width = "0%";
  el("value").textContent = formatRank(sim.rank);
  el("playing-hint").textContent =
    mode === "normal"
      ? sim.stage.subtitle
      : "같은 숫자는 두 배 · 무지개 공은 언제나 ×2";
  hintUntil = performance.now() + 7000;
  updateMenu();
  updateHUD();
  if (start) {
    sim.start();
    void audio.enable(audio.enabled).then(() => {
      updateSound();
      audio.play("click");
    });
  }
  lastTime = performance.now();
}
function pause() {
  if (sim.phase !== "running") return;
  sim.phase = "paused";
  releaseInput();
  record();
  el<HTMLDialogElement>("paused").showModal();
}
function resume() {
  el<HTMLDialogElement>("paused").close();
  if (sim.phase === "paused") sim.phase = "running";
  releaseInput();
  lastTime = performance.now();
}
function home() {
  record();
  reset();
}
function showResult() {
  if (finished) return;
  finished = true;
  releaseInput();
  const won = sim.phase === "won",
    newRecord =
      sim.mode === "endless" && sim.distance > progress.endlessDistance;
  record();
  el("result-tag").textContent = won
    ? "STAGE COMPLETE"
    : newRecord
      ? "NEW PERSONAL BEST"
      : "ONE MORE ROLL?";
  el("result-title").textContent = won
    ? sim.stageIndex === STAGES.length - 1
      ? "모든 스테이지 완료!"
      : `${sim.stage.name} 클리어!`
    : sim.mode === "endless"
      ? `${Math.floor(sim.distance)} m의 여정`
      : "다시 도전해 볼까요?";
  el("result-value").textContent = formatRank(sim.rank);
  el("result-value").style.background =
    `radial-gradient(circle at 30% 25%,#ffffffaa,${colorOfRank(sim.rank)} 65%)`;
  el("result-stars").textContent = won
    ? "★".repeat(sim.stars) + "☆".repeat(3 - sim.stars)
    : "";
  el("result-copy").textContent = won
    ? `최종 ${formatRank(sim.rank)} · ${sim.score.toLocaleString()}점 · ${sim.time.toFixed(1)}초`
    : sim.mode === "endless"
      ? `최고 숫자 ${formatRank(sim.peakRank)} · ${Math.floor(sim.distance / 88) + 1}번째 구간 · ${sim.score.toLocaleString()}점`
      : `최고 ${formatRank(sim.peakRank)} · ${Math.min(100, Math.round((sim.distance / sim.stage.length) * 100))}% 진행 · 목표 ${formatRank(sim.goalRank)}`;
  el("next-stage").hidden = !won;
  el("next-stage").textContent =
    sim.stageIndex === STAGES.length - 1
      ? "무한 모드 도전 →"
      : "다음 스테이지 →";
  el("again").classList.toggle("secondary", won);
  el<HTMLDialogElement>("result").showModal();
  el<HTMLButtonElement>("pause").disabled = true;
  el("playing-hint").hidden = true;
  updateMenu();
  if (won) audio.play("finish");
}
function handleEvent(event: GameEvent) {
  view.onEvent(event, sim);
  if (event.type === "merge") {
    toast(`✦ ×2 · ${formatRank(event.rank)}`);
    audio.play("merge", event.rank);
  } else if (event.type === "blocked") {
    toast("다른 숫자! 튕겨 나가요");
    audio.play("bounce");
  } else if (event.type === "damage") {
    toast(sim.phase === "lost" ? "앗! 다시 도전해요" : "앗! 숫자가 절반으로");
    audio.play("damage");
  } else if (event.type === "jump") {
    toast("↗ 점프!");
    audio.play("jump");
  } else if (event.type === "land") audio.play("land");
  else if (event.type === "fall") {
    toast("풍덩!");
    audio.play("fall");
  } else if (event.type === "checkpoint") {
    toast(`∞ ${Math.floor(sim.distance / 88) + 1}번째 구간`);
    audio.play("checkpoint");
    record();
  }
}
function updateHUD() {
  el("value").textContent = formatRank(sim.rank);
  document.querySelector<HTMLElement>(".score-dot")!.style.background =
    colorOfRank(sim.rank);
  const percentage =
    sim.mode === "normal"
      ? Math.min(100, (sim.distance / sim.stage.length) * 100)
      : ((sim.distance % 88) / 88) * 100;
  el("progress").style.width = `${percentage}%`;
  const bar = document.querySelector(".progress-track")!;
  bar.setAttribute("aria-valuenow", String(Math.round(percentage)));
  bar.setAttribute(
    "aria-label",
    sim.mode === "normal" ? "트랙 진행률" : "다음 무한 구간까지 진행률",
  );
  el("distance").textContent = `${Math.floor(sim.distance)} m`;
  el("speed").textContent =
    `${Math.round(Math.hypot(sim.physics.velocity().x, sim.physics.velocity().z) * 3.6)} km/h`;
}
function frame(now: number) {
  try {
    const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.1));
    lastTime = now;
    if (sim.phase === "running") {
      const left = keys.has("arrowleft") || keys.has("a"),
        right = keys.has("arrowright") || keys.has("d");
      sim.targetX = Math.max(
        -STEERING_LIMIT,
        Math.min(
          STEERING_LIMIT,
          sim.targetX + (Number(right) - Number(left)) * dt * 6,
        ),
      );
      for (const event of sim.update(dt)) handleEvent(event);
      updateHUD();
      if (sim.finished) showResult();
    }
    audio.update(
      Math.abs(sim.physics.velocity().z),
      sim.physics.grounded,
      sim.phase === "running",
    );
    if (now > toastUntil) el("toast").classList.remove("show");
    if (now > hintUntil) el("playing-hint").hidden = true;
    view.render(sim, sim.phase === "paused" ? 0 : Math.min(dt, 0.05), sim.time);
    requestAnimationFrame(frame);
  } catch (error) {
    console.error("Game runtime failed", error);
    audio.update(0, false, false);
    el("error-copy").textContent =
      "게임을 실행하는 중 오류가 발생했어요. 다시 시도해 주세요.";
    el("error").hidden = false;
  }
}
async function boot() {
  try {
    await Promise.all([
      Physics.init(),
      document.fonts
        ? Promise.race([
            document.fonts.ready,
            new Promise((resolve) => setTimeout(resolve, 1500)),
          ])
        : Promise.resolve(),
    ]);
    sim = new Simulation();
    view = new GameView(el("scene"));
    audio.enabled = progress.sound;
    audio.setVolume(progress.volume);
    updateSound();
    el<HTMLInputElement>("eyes").checked = progress.eyes;
    el<HTMLInputElement>("motion").checked = progress.reducedMotion;
    el<HTMLInputElement>("volume").value = String(
      Math.round(progress.volume * 100),
    );
    el("volume-label").textContent = `${Math.round(progress.volume * 100)}%`;
    reset();
    el("loading").hidden = true;
    el("start").addEventListener("click", () => reset(true));
    el("again").addEventListener("click", () => reset(true));
    el("restart").addEventListener("click", () => reset(true));
    el("home").addEventListener("click", home);
    el("pause-home").addEventListener("click", home);
    el("next-stage").addEventListener("click", () => {
      if (sim.stageIndex === STAGES.length - 1) mode = "endless";
      else selectedStage++;
      persist();
      reset(true);
    });
    for (const choice of ["normal", "endless"] as const)
      el(`${choice}-mode`).addEventListener("click", () => {
        mode = choice;
        reset();
        persist();
        audio.play("click");
      });
    el("stage-select").addEventListener("click", () => {
      stageGrid();
      el<HTMLDialogElement>("stages").showModal();
    });
    el("pause").addEventListener("click", pause);
    el("resume").addEventListener("click", resume);
    const changeSound = async (enabled: boolean) => {
      await audio.enable(enabled);
      updateSound();
      persist();
      if (enabled) audio.play("click");
    };
    el("sound").addEventListener("click", () => {
      void changeSound(!audio.enabled);
    });
    el("effects").addEventListener("change", () => {
      void changeSound(el<HTMLInputElement>("effects").checked);
    });
    el("volume").addEventListener("input", () => {
      audio.setVolume(Number(el<HTMLInputElement>("volume").value) / 100);
      el("volume-label").textContent = `${Math.round(audio.volume * 100)}%`;
      persist();
    });
    el("settings-button").addEventListener("click", () => {
      settingsPaused = sim.phase === "running";
      if (settingsPaused) sim.phase = "paused";
      releaseInput();
      el<HTMLDialogElement>("settings").showModal();
    });
    el("settings").addEventListener("close", () => {
      if (settingsPaused && sim.phase === "paused") sim.phase = "running";
      settingsPaused = false;
      releaseInput();
      lastTime = performance.now();
    });
    el("eyes").addEventListener("change", () => {
      progress.eyes = el<HTMLInputElement>("eyes").checked;
      view.setEyes(progress.eyes);
      persist();
    });
    el("motion").addEventListener("change", () => {
      progress.reducedMotion = el<HTMLInputElement>("motion").checked;
      view.reducedMotion = progress.reducedMotion;
      persist();
    });
    el("paused").addEventListener("cancel", (event) => {
      event.preventDefault();
      resume();
    });
    el("result").addEventListener("cancel", (event) => {
      event.preventDefault();
      home();
    });
    window.addEventListener("keydown", (event) => {
      if (document.querySelector("dialog[open]")) return;
      const key = event.key.toLowerCase();
      if (["arrowleft", "arrowright", "a", "d"].includes(key)) {
        event.preventDefault();
        keys.add(key);
        if (!event.repeat && sim.phase === "running")
          sim.targetX += ["arrowleft", "a"].includes(key) ? -0.35 : 0.35;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (sim.phase === "ready") reset(true);
        else pause();
      }
      if (event.key === "Escape") pause();
    });
    window.addEventListener("keyup", (event) =>
      keys.delete(event.key.toLowerCase()),
    );
    const canvas = view.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      if (sim.phase !== "running" || pointer) return;
      pointer = { id: event.pointerId, x: event.clientX, target: sim.targetX };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!pointer || pointer.id !== event.pointerId || sim.phase !== "running")
        return;
      sim.targetX = Math.max(
        -STEERING_LIMIT,
        Math.min(
          STEERING_LIMIT,
          pointer.target +
            ((event.clientX - pointer.x) / Math.min(innerWidth, 600)) * 9,
        ),
      );
    });
    const endPointer = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = null;
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("lostpointercapture", endPointer);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) pause();
    });
    window.addEventListener("pagehide", record);
    new ResizeObserver(() =>
      view.resize(el("scene").clientWidth, el("scene").clientHeight),
    ).observe(el("scene"));
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      pause();
      el("error-copy").textContent =
        "그래픽 연결이 중단되었어요. 새로고침하면 다시 플레이할 수 있습니다.";
      el("error").hidden = false;
    });
    requestAnimationFrame(frame);
  } catch (error) {
    console.error("Game initialization failed", error);
    el("loading").hidden = true;
    el("error-copy").textContent =
      "물리엔진 또는 그래픽을 준비하지 못했어요. 다시 시도해 주세요.";
    el("error").hidden = false;
  }
}
void boot();
