export type Mode = "normal" | "endless";
export type ObjectKind = "ball" | "wild" | "spike" | "gate" | "bumper" | "jump";
export interface CourseObject {
  id: number;
  chunk: number;
  kind: ObjectKind;
  x: number;
  distance: number;
  rank: number;
  width: number;
  consumed: boolean;
  travel?: number;
  frequency?: number;
}
export interface Surface {
  start: number;
  end: number;
  x: number;
  width: number;
  h0: number;
  h1: number;
  rails: boolean;
  friction: number;
}
export interface Chunk {
  id: number;
  start: number;
  end: number;
  surfaces: Surface[];
  objects: CourseObject[];
}
export interface Stage {
  name: string;
  subtitle: string;
  sky: string;
  water: string;
  rail: string;
  tile: string;
  startRank: number;
  goalRank: number;
  length: number;
  speed: number;
}
export const STAGES: readonly Stage[] = [
  {
    name: "아쿠아 산책",
    subtitle: "같은 숫자를 차례로 모아보세요",
    sky: "#bdebf3",
    water: "#86d6e6",
    rail: "#a56bed",
    tile: "#d9ebee",
    startRank: 4,
    goalRank: 11,
    length: 82,
    speed: 5.4,
  },
  {
    name: "민트 점프",
    subtitle: "노란 발판을 밟고 다리 너머로",
    sky: "#c3eee2",
    water: "#77d7c2",
    rail: "#54bda9",
    tile: "#d6eee7",
    startRank: 4,
    goalRank: 11,
    length: 100,
    speed: 5.8,
  },
  {
    name: "선셋 슬라이드",
    subtitle: "움직이는 범퍼 사이로 빠져나가세요",
    sky: "#f5ddcf",
    water: "#efb898",
    rail: "#ed968f",
    tile: "#f3e4dc",
    startRank: 5,
    goalRank: 12,
    length: 108,
    speed: 6.1,
  },
  {
    name: "아이스 드리프트",
    subtitle: "얼음 위에서는 미리 방향을 바꿔요",
    sky: "#cee7ff",
    water: "#90c1ed",
    rail: "#7c9ce4",
    tile: "#dceafe",
    startRank: 5,
    goalRank: 12,
    length: 116,
    speed: 6.4,
  },
  {
    name: "라벤더 브리지",
    subtitle: "난간 없는 다리에서는 가운데로",
    sky: "#e0d9f5",
    water: "#b8a4e6",
    rail: "#9975d0",
    tile: "#e9e1f4",
    startRank: 6,
    goalRank: 13,
    length: 124,
    speed: 6.7,
  },
  {
    name: "스타라이트 런",
    subtitle: "점프와 범퍼를 넘어 마지막 도전",
    sky: "#b7cee9",
    water: "#799fc9",
    rail: "#aa82ed",
    tile: "#d7dfee",
    startRank: 6,
    goalRank: 13,
    length: 132,
    speed: 7,
  },
];
const COLORS = [
  "#ffad22",
  "#7cdf2b",
  "#1fc3a7",
  "#00d7e8",
  "#078deb",
  "#a24eee",
  "#f344be",
  "#8be72c",
  "#ffdc25",
  "#ff942b",
  "#8458eb",
  "#fa5188",
  "#45dacc",
];
export function colorOfRank(rank: number) {
  return COLORS[Math.max(0, rank - 1) % COLORS.length];
}
export function radiusOfRank(rank: number) {
  return Math.min(1.25, 0.48 + Math.max(0, rank - 1) * 0.042);
}
export function formatRank(rank: number): string {
  if (rank <= 13) return String(2 ** rank);
  if (rank > 49) return `2^${rank}`;
  const value = 2 ** rank;
  const suffixes = ["", "K", "M", "B", "T"];
  const group = Math.min(4, Math.floor(Math.log10(value) / 3));
  return `${Number((value / 1000 ** group).toFixed(1))}${suffixes[group]}`;
}
function surface(
  start: number,
  end: number,
  options: Partial<Surface> = {},
): Surface {
  return {
    start,
    end,
    x: 0,
    width: 7.6,
    h0: 0,
    h1: 0,
    rails: true,
    friction: 0.65,
    ...options,
  };
}
export function createChunk(
  id: number,
  start: number,
  stageIndex: number,
  mode: Mode,
  baseRank: number,
): Chunk {
  const stage = STAGES[stageIndex],
    length = mode === "endless" ? 88 : stage.length;
  const objects: CourseObject[] = [];
  const add = (
    kind: ObjectKind,
    x: number,
    d: number,
    rank = 0,
    width = 0.5,
    extra: Partial<CourseObject> = {},
  ) =>
    objects.push({
      id: id * 1000 + objects.length,
      chunk: id,
      kind,
      x,
      distance: start + d,
      rank,
      width,
      consumed: false,
      ...extra,
    });
  const variant = mode === "endless" ? id % 6 : stageIndex;
  for (let row = 0; row < 7; row++) {
    const lane = variant === 2 ? 1.6 + Math.sin(row * 1.4) * 0.25 : 1.85;
    for (const x of [-lane, lane])
      add("ball", x, 7 + row * 4.7, baseRank + row);
  }
  add("spike", -2.4, 43, 0, 0.65);
  add("spike", 2.4, 43, 0, 0.65);
  let surfaces: Surface[];
  if (variant === 1 || variant === 5) {
    surfaces = [
      surface(start - 8, start + 48),
      surface(start + 48, start + 52, { h1: 1.1 }),
      surface(start + 56, start + 64, { width: 3.5, rails: false }),
      surface(start + 64, start + length + 3),
    ];
    add("jump", 0, 50.5, 0, 3.45);
    add("wild", 0, 61, baseRank + 7);
  } else if (variant === 4) {
    surfaces = [
      surface(start - 8, start + 47),
      surface(start + 47, start + 64, { width: 3.05, rails: false }),
      surface(start + 64, start + length + 3),
    ];
    add("wild", 0, 57, baseRank + 7);
  } else if (variant === 3) {
    surfaces = [
      surface(start - 8, start + 39),
      surface(start + 39, start + 66, { friction: 0.08 }),
      surface(start + 66, start + length + 3),
    ];
    add("spike", -1.7, 52, 0, 1.1);
    add("spike", 1.7, 61, 0, 1.1);
  } else {
    surfaces = [surface(start - 8, start + length + 3)];
    add("spike", 0, 52, 0, 0.85);
  }
  if (variant >= 2 && variant !== 3) {
    add("bumper", 0, 69, 0, 0.58, {
      travel: 2.45,
      frequency: 1.4 + variant * 0.12,
    });
    if (mode === "normal")
      add("bumper", 0, length - 19, 0, 0.62, { travel: 2.25, frequency: 1.9 });
  } else {
    add("gate", -2.8, 66, 0, 0.45);
    add("gate", 2.8, 66, 0, 0.45);
  }
  add("wild", 0, mode === "endless" ? 77 : length - 8, baseRank + 7);
  if (mode === "normal" && length > 100) {
    add("ball", -1.6, length - 31, baseRank + 7);
    add("ball", 1.6, length - 31, baseRank + 7);
  }
  if (id > 0) surfaces[0].start = start;
  if (mode === "endless") surfaces[surfaces.length - 1].end = start + length;
  else {
    surfaces[surfaces.length - 1].end = start + length - 8;
    surfaces.push(
      surface(start + length - 8, start + length - 4, { h1: 0.4 }),
      surface(start + length - 4, start + length + 3, { h0: 0.4, h1: 0.4 }),
    );
  }
  return { id, start, end: start + length, surfaces, objects };
}
