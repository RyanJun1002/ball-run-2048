import { before, test } from "node:test";
import assert from "node:assert/strict";
import { Physics } from "../src/physics.ts";
import { Simulation, type GameEvent } from "../src/simulation.ts";
import {
  STAGES,
  createChunk,
  formatRank,
  radiusOfRank,
  type Chunk,
  type CourseObject,
} from "../src/course.ts";
import { cleanProgress, unlocked } from "../src/progress.ts";
before(async () => {
  await Physics.init();
});
function steer(sim: Simulation) {
  const chunk =
    sim.chunks.find((c) => sim.distance >= c.start && sim.distance < c.end) ??
    sim.chunks[0];
  const d = sim.distance - chunk.start,
    variant = sim.mode === "endless" ? chunk.id % 6 : sim.stageIndex;
  sim.targetX =
    d < 37
      ? -1.85
      : d < 47
        ? 0
        : variant === 0 || variant === 2
          ? d < 59
            ? -1.9
            : 0
          : 0;
  if (variant === 3)
    sim.targetX =
      d < 35 ? -1.85 : d < 46 ? 0 : d < 54 ? 1.5 : d < 63 ? -1.5 : 0;
  const bumper = sim.chunks
    .flatMap((c) => c.objects)
    .filter((o) => o.kind === "bumper")
    .find(
      (o) => o.distance > sim.distance - 1 && o.distance < sim.distance + 9,
    );
  if (bumper) {
    const arrival =
      sim.time + Math.max(0, bumper.distance - sim.distance) / sim.speed;
    const x =
      Math.sin(arrival * bumper.frequency! + bumper.id) * bumper.travel!;
    sim.targetX = x > 0 ? -2.3 : 2.3;
  }
}
function fixture(objects: CourseObject[] = []) {
  const sim = new Simulation();
  for (const chunk of sim.chunks) sim.physics.removeChunk(chunk);
  const chunk: Chunk = {
    id: 0,
    start: 0,
    end: 90,
    surfaces: [
      {
        start: -8,
        end: 90,
        x: 0,
        width: 7.6,
        h0: 0,
        h1: 0,
        rails: true,
        friction: 0.65,
      },
    ],
    objects,
  };
  sim.chunks = [chunk];
  sim.physics.addChunk(chunk);
  sim.start();
  return sim;
}
const obstacle = (
  kind: CourseObject["kind"],
  id = 0,
  rank = 0,
): CourseObject => ({
  id,
  chunk: 0,
  kind,
  x: 0,
  distance: 5,
  rank,
  width: 0.7,
  consumed: false,
});

test("6개 스테이지에는 대칭 숫자 줄과 서로 다른 지형이 있다", () => {
  const courses = STAGES.map((stage, i) =>
    createChunk(0, 0, i, "normal", stage.startRank),
  );
  for (const course of courses) {
    const balls = course.objects.filter((o) => o.kind === "ball").slice(0, 14);
    assert.equal(balls.length, 14);
    for (let i = 0; i < 7; i++) {
      assert.equal(balls[2 * i].rank, balls[0].rank + i);
      assert.equal(balls[2 * i].x, -balls[2 * i + 1].x);
    }
  }
  assert.ok(courses[1].objects.some((o) => o.kind === "jump"));
  assert.ok(courses[2].objects.some((o) => o.kind === "bumper"));
  assert.ok(courses[3].surfaces.some((s) => s.friction < 0.15));
  assert.ok(courses[4].surfaces.some((s) => !s.rails));
});
test("힘과 마찰로 전진하면서 실제 회전이 생기고 바닥에 안착한다", () => {
  const sim = fixture();
  try {
    for (let i = 0; i < 120; i++) sim.update(1 / 60);
    const pose = sim.physics.pose(),
      a = sim.physics.player.angvel();
    assert.ok(sim.distance > 7);
    assert.ok(Math.abs(a.x) > 1);
    assert.ok(Math.abs(pose.qw) < 0.999);
    assert.ok(Math.abs(pose.y - radiusOfRank(4)) < 0.08);
  } finally {
    sim.dispose();
  }
});
test("30fps와 60fps에서 고정 시간 간격 물리 결과가 일치한다", () => {
  const a = fixture(),
    b = fixture();
  try {
    a.targetX = -1.85;
    b.targetX = -1.85;
    for (let i = 0; i < 180; i++) a.update(1 / 60);
    for (let i = 0; i < 90; i++) b.update(1 / 30);
    assert.ok(Math.abs(a.distance - b.distance) < 0.06);
    assert.ok(Math.abs(a.x - b.x) < 0.02);
  } finally {
    a.dispose();
    b.dispose();
  }
});
for (let stage = 0; stage < STAGES.length; stage++)
  test(`${stage + 1} 스테이지를 물리 입력으로 완주할 수 있다`, () => {
    const sim = new Simulation();
    try {
      sim.reset("normal", stage);
      sim.start();
      const events: GameEvent[] = [];
      let maxY = 0;
      for (let i = 0; i < 6000 && !sim.finished; i++) {
        steer(sim);
        events.push(...sim.update(1 / 60));
        maxY = Math.max(maxY, sim.physics.pose().y);
      }
      assert.equal(sim.phase, "won");
      assert.ok(sim.rank >= sim.goalRank);
      assert.ok(sim.stars > 0);
      assert.ok(events.some((e) => e.type === "merge"));
      if (stage === 1 || stage === 5) {
        assert.ok(events.some((e) => e.type === "jump"));
        assert.ok(events.some((e) => e.type === "land"));
        assert.ok(maxY > 2.5);
      }
    } finally {
      sim.dispose();
    }
  });
test("한 스파이크 무리의 여러 접촉은 피해 한 번으로 처리된다", () => {
  const a = obstacle("spike"),
    b = { ...obstacle("spike", 1), distance: 5.15 };
  const sim = fixture([a, b]);
  try {
    for (let i = 0; i < 140; i++) sim.update(1 / 60);
    assert.equal(sim.rank, 3);
    assert.equal(sim.damageCount, 1);
  } finally {
    sim.dispose();
  }
});
test("16은 8과 1024를 먹지 않고 충격량으로 튕긴다", () => {
  for (const rank of [3, 10]) {
    const object = obstacle("ball", 0, rank),
      sim = fixture([object]);
    try {
      let bounced = false;
      for (let i = 0; i < 180 && !sim.finished; i++) {
        const events = sim.update(1 / 60);
        if (events.some((e) => e.type === "blocked")) {
          bounced = true;
          const body = sim.physics.objectPose(0)!;
          assert.ok(body.y > 0);
          const beforeX = body.x;
          const beforeZ = body.z;
          for (let j = 0; j < 10; j++) sim.update(1 / 60);
          const after = sim.physics.objectPose(0)!;
          assert.ok(Math.abs(after.x - beforeX) > 0.08);
          assert.ok(after.z < beforeZ - 0.1);
          break;
        }
      }
      assert.ok(bounced);
      assert.equal(object.consumed, false);
      assert.equal(sim.rank, 4);
      assert.equal(sim.score, 0);
      assert.equal(sim.damageCount, 0);
      assert.equal(sim.phase, "running");
    } finally {
      sim.dispose();
    }
  }
});
test("같은 숫자와 무지개 공만 합쳐져 두 배가 된다", () => {
  for (const kind of ["ball", "wild"] as const) {
    const object = obstacle(kind, 0, 4),
      sim = fixture([object]);
    try {
      for (let i = 0; i < 120; i++) sim.update(1 / 60);
      assert.equal(sim.rank, 5);
      assert.equal(object.consumed, true);
      assert.equal(sim.physics.objectPose(0), null);
    } finally {
      sim.dispose();
    }
  }
});
test("모든 스테이지와 무한 모드에서 양옆 턱을 넘어 바다에 빠진다", () => {
  for (const mode of ["normal", "endless"] as const) {
    for (let stage = 0; stage < (mode === "normal" ? 6 : 1); stage++) {
      for (const side of [-1, 1]) {
        const sim = new Simulation();
        try {
          sim.reset(mode, stage);
          sim.start();
          sim.targetX = side * 6.5;
          const events: GameEvent[] = [];
          for (let i = 0; i < 360 && !sim.finished; i++)
            events.push(...sim.update(1 / 60));
          assert.equal(sim.phase, "lost", `${mode} ${stage} ${side}`);
          assert.ok(events.some((e) => e.type === "fall"));
          assert.ok(Math.abs(sim.x) > 4);
        } finally {
          sim.dispose();
        }
      }
    }
  }
});
test("난간 없는 좁은 다리의 바깥으로 가면 중력으로 떨어진다", () => {
  const sim = new Simulation();
  try {
    sim.reset("normal", 4);
    sim.start();
    let fall = false;
    for (let i = 0; i < 1500 && !sim.finished; i++) {
      sim.targetX = 3.15;
      fall ||= sim.update(1 / 60).some((e) => e.type === "fall");
    }
    assert.equal(sim.phase, "lost");
    assert.ok(fall);
    assert.ok(sim.physics.pose().y < -3);
  } finally {
    sim.dispose();
  }
});
test("일시 정지와 잘못된 시간 입력은 물리 상태를 바꾸지 않는다", () => {
  const sim = fixture();
  try {
    sim.update(NaN);
    sim.update(-1);
    assert.equal(sim.distance, 0);
    sim.phase = "paused";
    const before = sim.physics.pose();
    sim.update(10);
    assert.deepEqual(sim.physics.pose(), before);
    sim.reset();
    assert.equal(sim.phase, "ready");
    assert.equal(sim.rank, 4);
  } finally {
    sim.dispose();
  }
});
test("무한 코스 2500m에서 재생성·좌표 이동·메모리 정리가 유지된다", () => {
  const sim = new Simulation();
  try {
    sim.reset("endless");
    sim.start();
    let maxBodies = 0,
      maxChunks = 0,
      checkpoints = 0;
    for (let i = 0; i < 120000 && !sim.finished && sim.distance < 2500; i++) {
      steer(sim);
      for (const e of sim.update(1 / 60))
        if (e.type === "checkpoint") checkpoints++;
      maxBodies = Math.max(maxBodies, sim.physics.size);
      maxChunks = Math.max(maxChunks, sim.chunks.length);
    }
    assert.equal(sim.phase, "running");
    assert.ok(sim.distance >= 2500);
    assert.ok(sim.physics.origin >= 2048);
    assert.ok(maxBodies < 80);
    assert.ok(maxChunks <= 3);
    assert.ok(checkpoints >= 28);
    assert.ok(sim.rank > 49);
    assert.match(formatRank(sim.rank), /^2\^\d+$/);
    assert.ok(Number.isFinite(sim.physics.pose().z));
  } finally {
    sim.dispose();
  }
});
test("일반 모드에서는 목표 숫자에 못 미치면 완주해도 실패한다", () => {
  const sim = fixture();
  try {
    for (let i = 0; i < 2000 && !sim.finished; i++) sim.update(1 / 60);
    assert.equal(sim.phase, "lost");
    assert.ok(sim.distance >= sim.stage.length);
  } finally {
    sim.dispose();
  }
});
test("저장 데이터 검증과 스테이지 해금 규칙", () => {
  const bad = cleanProgress({
    stars: [99, -1, "x"],
    stage: 5,
    bestRank: Infinity,
    volume: NaN,
    mode: "invalid",
  });
  assert.deepEqual(bad.stars, [3, 0, 0, 0, 0, 0]);
  assert.equal(bad.stage, 0);
  assert.equal(bad.bestRank, 4);
  assert.equal(bad.volume, 0.65);
  assert.equal(bad.mode, "normal");
  assert.equal(unlocked(bad, 1), true);
  assert.equal(unlocked(bad, 2), false);
  assert.equal(formatRank(10000), "2^10000");
});
