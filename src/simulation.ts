import {
  STAGES,
  createChunk,
  type Chunk,
  type Mode,
  type CourseObject,
} from "./course";
import { Physics, STEP } from "./physics";
export const STEERING_LIMIT = 6.5;
export type Phase = "ready" | "running" | "paused" | "won" | "lost";
export interface GameEvent {
  type:
    | "merge"
    | "damage"
    | "blocked"
    | "jump"
    | "land"
    | "finish"
    | "fall"
    | "checkpoint";
  rank: number;
  x: number;
  distance: number;
}
export class Simulation {
  phase: Phase = "ready";
  mode: Mode = "normal";
  stageIndex = 0;
  rank = 4;
  peakRank = 4;
  score = 0;
  distance = 0;
  time = 0;
  damageCount = 0;
  targetX = 0;
  physics: Physics;
  chunks: Chunk[] = [];
  private accumulator = 0;
  private hurtUntil = 0;
  private blockedUntil = new Map<number, number>();
  private nextChunk = 0;
  private events: GameEvent[] = [];
  private wasGrounded = true;
  private airTime = 0;
  private checkpoint = 0;
  constructor() {
    this.physics = new Physics(4);
    this.reset();
  }
  get stage() {
    return STAGES[this.stageIndex];
  }
  get finished() {
    return this.phase === "won" || this.phase === "lost";
  }
  get x() {
    return this.physics.pose().x;
  }
  get speed() {
    return (
      this.stage.speed +
      (this.mode === "endless" ? Math.min(5, this.distance / 450) : 0)
    );
  }
  get goalRank() {
    return this.stage.goalRank;
  }
  get stars() {
    return this.phase === "won"
      ? this.rank >= this.goalRank + 1
        ? 3
        : this.damageCount <= 1
          ? 2
          : 1
      : 0;
  }
  reset(mode: Mode = this.mode, stageIndex = this.stageIndex) {
    this.physics.dispose();
    this.mode = mode;
    this.stageIndex = Math.max(0, Math.min(STAGES.length - 1, stageIndex));
    this.rank = mode === "endless" ? 4 : this.stage.startRank;
    this.peakRank = this.rank;
    this.physics = new Physics(this.rank);
    this.phase = "ready";
    this.score = 0;
    this.distance = 0;
    this.time = 0;
    this.targetX = 0;
    this.damageCount = 0;
    this.accumulator = 0;
    this.hurtUntil = 0;
    this.nextChunk = 0;
    this.blockedUntil.clear();
    this.chunks = [];
    this.events = [];
    this.airTime = 0;
    this.wasGrounded = true;
    this.checkpoint = 0;
    this.appendChunk();
  }
  start() {
    if (this.phase === "ready") this.phase = "running";
  }
  private appendChunk() {
    const last = this.chunks.at(-1);
    const chunk = createChunk(
      this.nextChunk++,
      last?.end ?? 0,
      this.stageIndex,
      this.mode,
      this.rank,
    );
    this.chunks.push(chunk);
    this.physics.addChunk(chunk);
  }
  private emit(type: GameEvent["type"]) {
    this.events.push({
      type,
      rank: this.rank,
      x: this.x,
      distance: this.distance,
    });
  }
  private grow() {
    this.rank++;
    this.peakRank = Math.max(this.rank, this.peakRank);
    this.score += 100 + this.rank * 10;
    this.physics.resize(this.rank);
    this.emit("merge");
  }
  private damage(direction: number) {
    if (this.time < this.hurtUntil) return;
    this.hurtUntil = this.time + 0.75;
    this.damageCount++;
    if (this.rank <= 1) this.phase = "lost";
    else {
      this.rank--;
      this.physics.resize(this.rank);
      this.physics.hurt(direction);
    }
    this.emit("damage");
  }
  private contact(object: CourseObject) {
    if (object.consumed) return;
    if (object.kind === "jump") {
      if (this.physics.velocity().y < 4) {
        this.physics.jump(this.speed);
        this.emit("jump");
      }
      return;
    }
    if (object.kind === "ball" || object.kind === "wild") {
      if (object.kind === "wild" || object.rank === this.rank) {
        object.consumed = true;
        this.physics.removeObject(object.id);
        this.grow();
      } else if (this.time >= (this.blockedUntil.get(object.id) ?? 0)) {
        this.blockedUntil.set(object.id, this.time + 0.35);
        this.physics.repel(object.id);
        this.emit("blocked");
      }
    } else this.damage(Math.sign(this.x - object.x) || 1);
  }
  update(dt: number): GameEvent[] {
    this.events = [];
    if (this.phase !== "running" || !Number.isFinite(dt) || dt <= 0)
      return this.events;
    this.accumulator += Math.min(dt, 0.1);
    while (this.accumulator >= STEP && this.phase === "running") {
      this.accumulator -= STEP;
      this.time += STEP;
      this.targetX = Math.max(
        -STEERING_LIMIT,
        Math.min(STEERING_LIMIT, this.targetX),
      );
      const contacts = this.physics.step(this.targetX, this.speed, this.time);
      this.distance = Math.max(
        this.distance,
        this.physics.origin - this.physics.pose().z,
      );
      for (const id of contacts) {
        const object = this.chunks
          .flatMap((c) => c.objects)
          .find((o) => o.id === id);
        if (object) this.contact(object);
        if (this.finished) break;
      }
      if (!this.physics.grounded) this.airTime += STEP;
      if (this.physics.grounded && !this.wasGrounded) {
        if (this.airTime > 0.22) this.emit("land");
        this.airTime = 0;
      }
      this.wasGrounded = this.physics.grounded;
      if (this.physics.pose().y < -3.2) {
        this.phase = "lost";
        this.emit("fall");
      }
      if (
        this.mode === "normal" &&
        this.distance >= this.stage.length &&
        this.phase === "running"
      ) {
        this.phase = this.rank >= this.goalRank ? "won" : "lost";
        this.emit("finish");
      }
      if (this.mode === "endless") {
        if (this.distance > (this.chunks.at(-1)?.end ?? 0) - 35)
          this.appendChunk();
        while (
          this.chunks.length > 2 &&
          this.chunks[0].end < this.distance - 18
        ) {
          const chunk = this.chunks.shift()!;
          this.physics.removeChunk(chunk);
          for (const o of chunk.objects) this.blockedUntil.delete(o.id);
        }
        const current = Math.floor(this.distance / 88);
        if (current > this.checkpoint) {
          this.checkpoint = current;
          this.emit("checkpoint");
        }
        this.physics.rebase(this.distance);
      }
    }
    return this.events;
  }
  dispose() {
    this.physics.dispose();
  }
}
