import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  STAGES,
  colorOfRank,
  formatRank,
  radiusOfRank,
  type Chunk,
  type CourseObject,
  type Surface,
} from "./course";
import { Simulation, type GameEvent } from "./simulation";
import type { Pose } from "./physics";

interface BallView {
  group: THREE.Group;
  sphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
  label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh;
  rank: number;
  wild: boolean;
}
interface Particle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
}
export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(44, 1, 0.1, 180);
  private readonly chunks = new Map<number, THREE.Group>();
  private readonly balls = new Map<number, BallView>();
  private readonly obstacles = new Map<number, THREE.Group>();
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private readonly sphereGeometry = new THREE.SphereGeometry(1, 40, 28);
  private readonly particleGeometry = new THREE.IcosahedronGeometry(0.085, 0);
  private readonly shadowGeometry = new THREE.PlaneGeometry(1, 1);
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly player: BallView;
  private readonly water: THREE.ShaderMaterial;
  private readonly sea: THREE.Mesh;
  private readonly particles: Particle[] = [];
  private eyes = false;
  private pulse = 0;
  private shake = 0;
  private origin = 0;
  private stageIndex = 0;
  private cameraLook = 7;
  reducedMotion = false;
  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    container.append(this.renderer.domElement);
    this.scene.background = new THREE.Color("#bdebf3");
    this.scene.fog = new THREE.Fog("#bdebf3", 50, 110);
    const pmrem = new THREE.PMREMGenerator(this.renderer),
      room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#86c6d0", 0.8));
    const light = new THREE.DirectionalLight("#ffffff", 1.6);
    light.position.set(-8, 14, 8);
    this.scene.add(light);
    const rim = new THREE.DirectionalLight("#e6dfff", 0.65);
    rim.position.set(7, 5, -15);
    this.scene.add(rim);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!,
      gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
    gradient.addColorStop(0, "rgba(40,75,95,.28)");
    gradient.addColorStop(1, "rgba(40,75,95,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    });
    this.water = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        tint: { value: new THREE.Color("#86d6e6") },
      },
      vertexShader:
        "varying vec2 waterUV;void main(){waterUV=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader:
        "varying vec2 waterUV;uniform float time;uniform vec3 tint;void main(){float a=sin(waterUV.x*1.5+sin(waterUV.y*1.7)+time*.18);float b=sin(waterUV.y*2.+sin(waterUV.x*1.4)-time*.13);float line=smoothstep(.84,1.,a*b);gl_FragColor=vec4(mix(tint,vec3(.89,.98,1.),line*.4),1.);}",
    });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(350, 350), this.water);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.y = -1.2;
    this.scene.add(this.sea);
    this.player = this.createBall(4);
    this.scene.add(this.player.group, this.player.shadow);
    this.resize(container.clientWidth, container.clientHeight);
  }
  private labelTexture(text: string): THREE.CanvasTexture {
    const key = `label:${text}:${this.eyes}`;
    const existing = this.textures.get(key);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext("2d")!;
    let size = 240;
    ctx.font = `1000 ${size}px Nunito,Arial,sans-serif`;
    while (ctx.measureText(text).width > 450) {
      size -= 4;
      ctx.font = `1000 ${size}px Nunito,Arial,sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0d1723";
    ctx.lineWidth = 30;
    ctx.strokeText(text, 256, 170);
    ctx.fillStyle = "white";
    ctx.fillText(text, 256, 170);
    if (this.eyes)
      for (const x of [211, 301]) {
        ctx.beginPath();
        ctx.ellipse(x, 40, 25, 31, 0, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.fill();
        ctx.strokeStyle = "#233347";
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 3, 44, 11, 0, Math.PI * 2);
        ctx.fillStyle = "#233347";
        ctx.fill();
      }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, texture);
    if (this.textures.size > 80) {
      const oldest = [...this.textures.entries()].find(
        ([k]) =>
          k.startsWith("label:") &&
          ![
            "label:" + formatRank(this.player.rank) + ":" + this.eyes,
            ...[...this.balls.values()].map(
              (b) =>
                "label:" +
                (b.wild ? "×2" : formatRank(b.rank)) +
                ":" +
                this.eyes,
            ),
          ].includes(k),
      );
      if (oldest) {
        oldest[1].dispose();
        this.textures.delete(oldest[0]);
      }
    }
    return texture;
  }
  private rainbow() {
    let texture = this.textures.get("rainbow");
    if (texture) return texture;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 512, 150);
    [
      "#f75ac8",
      "#945af7",
      "#309aff",
      "#44ded0",
      "#bcf24b",
      "#ffe64f",
      "#ff8659",
      "#f75ac8",
    ].forEach((color, i) => gradient.addColorStop(i / 7, color));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 256);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set("rainbow", texture);
    return texture;
  }
  private createBall(rank: number, wild = false): BallView {
    const group = new THREE.Group(),
      material = new THREE.MeshPhysicalMaterial({
        color: wild || rank >= 11 ? "#ffffff" : colorOfRank(rank),
        map: wild || rank >= 11 ? this.rainbow() : null,
        roughness: 0.22,
        metalness: 0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.25,
      });
    const sphere = new THREE.Mesh(this.sphereGeometry, material);
    group.add(sphere);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.999, 0.013, 6, 80),
        new THREE.MeshBasicMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: 0.3,
        }),
      );
      ring.rotation.set(i ? Math.PI / 3 : Math.PI / 2, i ? Math.PI / 4 : 0, 0);
      sphere.add(ring);
    }
    for (const point of [
      [0.87, 0.34, 0.34],
      [-0.68, 0.6, -0.4],
      [0.1, -0.6, 0.79],
    ]) {
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 8, 6),
        new THREE.MeshBasicMaterial({
          color: "#ffffff",
          transparent: true,
          opacity: 0.6,
        }),
      );
      dot.position
        .set(point[0], point[1], point[2])
        .normalize()
        .multiplyScalar(1.001);
      sphere.add(dot);
    }
    const labelGeometry = new THREE.PlaneGeometry(1.65, 1.05, 20, 14);
    const positions = labelGeometry.attributes.position;
    const point = new THREE.Vector3();
    for (let i = 0; i < positions.count; i++) {
      point
        .set(positions.getX(i), positions.getY(i), 1)
        .normalize()
        .multiplyScalar(1.008);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    labelGeometry.computeVertexNormals();
    const label = new THREE.Mesh(
      labelGeometry,
      new THREE.MeshBasicMaterial({
        map: this.labelTexture(wild ? "×2" : formatRank(rank)),
        transparent: true,
        alphaTest: 0.03,
        depthWrite: false,
      }),
    );
    label.rotation.x = -0.55;
    sphere.add(label);
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    this.scene.add(shadow);
    return { group, sphere, label, shadow, rank, wild };
  }
  private disposeBall(ball: BallView) {
    this.scene.remove(ball.group, ball.shadow);
    ball.sphere.material.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const child of ball.sphere.children)
      if (child instanceof THREE.Mesh) {
        geometries.add(child.geometry);
        materials.add(child.material);
      }
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  }

  private disposeGroup(group: THREE.Group) {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        geometries.add(child.geometry);
        for (const mat of Array.isArray(child.material)
          ? child.material
          : [child.material]) {
          materials.add(mat);
          if (mat.map) textures.add(mat.map);
        }
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    this.scene.remove(group);
  }
  setEyes(enabled: boolean) {
    this.eyes = enabled;
    for (const ball of [this.player, ...this.balls.values()])
      ball.label.material.map = this.labelTexture(
        ball.wild ? "×2" : formatRank(ball.rank),
      );
  }
  private addSurface(group: THREE.Group, s: Surface, chunk: Chunk) {
    const theme = STAGES[this.stageIndex],
      length = s.end - s.start,
      angle = Math.atan2(s.h1 - s.h0, length),
      realLength = Math.hypot(length, s.h1 - s.h0);
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = s.friction < 0.15 ? "#c3e8ff" : theme.tile;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillRect(64, 64, 64, 64);
    const checker = new THREE.CanvasTexture(canvas);
    checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
    checker.repeat.set(s.width / 1.9, realLength / 1.9);
    checker.colorSpace = THREE.SRGBColorSpace;
    checker.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy(),
    );
    const floorGroup = new THREE.Group();
    floorGroup.position.set(
      s.x,
      (s.h0 + s.h1) / 2,
      chunk.start - (s.start + s.end) / 2,
    );
    floorGroup.rotation.x = angle;
    group.add(floorGroup);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(s.width, 0.24, realLength),
      new THREE.MeshBasicMaterial({ color: theme.tile }),
    );
    slab.position.y = -0.12;
    floorGroup.add(slab);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(s.width, realLength),
      new THREE.MeshBasicMaterial({ map: checker }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.003;
    floorGroup.add(floor);
    if (s.rails)
      for (const x of [-s.width / 2 - 0.16, s.width / 2 + 0.16]) {
        const wall = new THREE.Mesh(
          new RoundedBoxGeometry(0.32, 0.055, realLength, 2, 0.02),
          new THREE.MeshStandardMaterial({
            color: theme.rail,
            roughness: 0.42,
            envMapIntensity: 0.1,
          }),
        );
        wall.position.set(x, 0.0275, 0);
        floorGroup.add(wall);
        const cap = new THREE.Mesh(
          new RoundedBoxGeometry(0.32, 0.018, realLength, 2, 0.008),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(theme.rail).lerp(
              new THREE.Color("white"),
              0.4,
            ),
          }),
        );
        cap.position.set(x, 0.061, 0);
        floorGroup.add(cap);
      }
    else
      for (const x of [-s.width / 2 + 0.055, s.width / 2 - 0.055]) {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.025, realLength),
          new THREE.MeshBasicMaterial({ color: "#ffe56a" }),
        );
        line.position.set(x, 0.025, 0);
        floorGroup.add(line);
      }
  }
  private addFinish(group: THREE.Group, chunk: Chunk) {
    const material = new THREE.MeshStandardMaterial({
      color: STAGES[this.stageIndex].rail,
      roughness: 0.4,
      envMapIntensity: 0.1,
    });
    for (const x of [-3.45, 3.45]) {
      const post = new THREE.Mesh(
        new RoundedBoxGeometry(0.28, 4, 0.3, 2, 0.1),
        material,
      );
      post.position.set(x, 2.2, chunk.start - chunk.end);
      group.add(post);
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 180;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = STAGES[this.stageIndex].rail;
    ctx.fillRect(0, 0, 1024, 180);
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 82px Nunito,Arial";
    ctx.fillText(
      `FINISH  ✦  ${formatRank(STAGES[this.stageIndex].goalRank)}`,
      512,
      95,
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(6.9, 1.1),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    banner.position.set(0, 3.7, chunk.start - chunk.end);
    group.add(banner);
    for (let i = 0; i < 10; i++) {
      const square = new THREE.Mesh(
        new THREE.PlaneGeometry(0.76, 0.8),
        new THREE.MeshBasicMaterial({ color: i % 2 ? "#584371" : "#fff" }),
      );
      square.rotation.x = -Math.PI / 2;
      square.position.set((i - 4.5) * 0.76, 0.415, chunk.start - chunk.end);
      group.add(square);
    }
  }
  private createObstacle(object: CourseObject) {
    const group = new THREE.Group();
    if (object.kind === "spike") {
      const count = Math.max(2, Math.round(object.width * 4));
      const geometry = new THREE.ConeGeometry(0.24, 0.83, 12),
        material = new THREE.MeshStandardMaterial({
          color: "#f52750",
          roughness: 0.32,
          envMapIntensity: 0.1,
        });
      for (let i = 0; i < count; i++) {
        const cone = new THREE.Mesh(geometry, material);
        cone.position.set((i - (count - 1) / 2) * 0.43, 0.16, 0);
        group.add(cone);
      }
      const base = new THREE.Mesh(
        new RoundedBoxGeometry(object.width * 2, 0.1, 0.78, 2, 0.06),
        new THREE.MeshStandardMaterial({
          color: "#e3234a",
          envMapIntensity: 0.1,
        }),
      );
      base.position.y = -0.23;
      group.add(base);
    } else if (object.kind === "jump") {
      const pad = new THREE.Mesh(
        new RoundedBoxGeometry(object.width * 2, 0.11, 1, 2, 0.06),
        new THREE.MeshStandardMaterial({
          color: "#ffcf37",
          emissive: "#654900",
          emissiveIntensity: 0.12,
          envMapIntensity: 0.1,
        }),
      );
      group.add(pad);
      for (const x of [-2, -1, 0, 1, 2]) {
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.19, 0.4, 3),
          new THREE.MeshBasicMaterial({ color: "#fff9da" }),
        );
        arrow.rotation.x = -Math.PI / 2;
        arrow.position.set(x, 0.1, 0);
        group.add(arrow);
      }
    } else {
      const material = new THREE.MeshStandardMaterial({
        color: object.kind === "bumper" ? "#f078a9" : "#304c5b",
        roughness: 0.3,
        envMapIntensity: 0.15,
      });
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(object.width, object.width, 2.3, 20),
        material,
      );
      group.add(pole);
      for (const y of [-0.8, 0.8]) {
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(
            object.width + 0.02,
            object.width + 0.02,
            0.13,
            20,
          ),
          new THREE.MeshBasicMaterial({
            color: object.kind === "bumper" ? "#fff3a5" : "#7fe3dc",
          }),
        );
        ring.position.y = y;
        group.add(ring);
      }
    }
    this.scene.add(group);
    return group;
  }
  reset(sim: Simulation) {
    for (const group of this.chunks.values()) this.disposeGroup(group);
    this.chunks.clear();
    for (const ball of this.balls.values()) this.disposeBall(ball);
    this.balls.clear();
    for (const group of this.obstacles.values()) this.disposeGroup(group);
    this.obstacles.clear();
    this.clearParticles();
    this.pulse = 0;
    this.shake = 0;
    this.origin = 0;
    this.stageIndex = sim.stageIndex;
    const theme = sim.stage;
    this.scene.background = new THREE.Color(theme.sky);
    (this.scene.fog as THREE.Fog).color.set(theme.sky);
    this.water.uniforms.tint.value.set(theme.water).convertLinearToSRGB();
    this.cameraLook = this.camera.aspect < 0.8 ? 0 : 7;
    this.sync(sim);
  }
  private sync(sim: Simulation) {
    const alive = new Set(sim.chunks.map((c) => c.id));
    for (const [id, group] of this.chunks)
      if (!alive.has(id)) {
        this.disposeGroup(group);
        this.chunks.delete(id);
      }
    const objectIds = new Set<number>();
    for (const chunk of sim.chunks) {
      if (!this.chunks.has(chunk.id)) {
        const group = new THREE.Group();
        for (const s of chunk.surfaces) this.addSurface(group, s, chunk);
        if (sim.mode === "normal") this.addFinish(group, chunk);
        this.scene.add(group);
        this.chunks.set(chunk.id, group);
      }
      this.chunks.get(chunk.id)!.position.z = sim.physics.origin - chunk.start;
      for (const object of chunk.objects) {
        if (object.consumed) continue;
        objectIds.add(object.id);
        if (object.kind === "ball" || object.kind === "wild") {
          if (!this.balls.has(object.id)) {
            const ball = this.createBall(object.rank, object.kind === "wild");
            this.scene.add(ball.group);
            this.balls.set(object.id, ball);
          }
        } else if (!this.obstacles.has(object.id))
          this.obstacles.set(object.id, this.createObstacle(object));
      }
    }
    for (const [id, ball] of this.balls)
      if (!objectIds.has(id)) {
        this.disposeBall(ball);
        this.balls.delete(id);
      }
    for (const [id, group] of this.obstacles)
      if (!objectIds.has(id)) {
        this.disposeGroup(group);
        this.obstacles.delete(id);
      }
  }
  resize(width: number, height: number) {
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.fov = width / height < 0.65 ? 53 : 44;
    this.camera.updateProjectionMatrix();
  }
  onEvent(event: GameEvent, sim: Simulation) {
    if (event.type === "merge") {
      this.pulse = 0.3;
      this.burst(
        event.x,
        sim.physics.origin - event.distance,
        colorOfRank(event.rank),
        18,
      );
    }
    if (event.type === "damage") {
      this.shake = 0.2;
      this.burst(event.x, sim.physics.origin - event.distance, "#ff4563", 14);
    }
    if (event.type === "land") this.shake = 0.09;
    if (event.type === "finish" && sim.phase === "won")
      this.burst(event.x, sim.physics.origin - event.distance, "#ac8aff", 60);
    if (event.type === "fall")
      this.burst(event.x, sim.physics.origin - event.distance, "#dcf7ff", 35);
  }
  private burst(x: number, z: number, color: string, count: number) {
    if (this.reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        this.particleGeometry,
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      mesh.position.set(x, 1, z);
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        life: 1,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 5,
          2 + Math.random() * 4,
          (Math.random() - 0.5) * 4,
        ),
      });
    }
  }
  private clearParticles() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
    }
    this.particles.length = 0;
  }
  private updateBall(ball: BallView, pose: Pose, rank: number, pulse = 1) {
    if (ball.rank !== rank) {
      ball.rank = rank;
      ball.sphere.material.color.set(rank >= 11 ? "#fff" : colorOfRank(rank));
      ball.sphere.material.map = rank >= 11 ? this.rainbow() : null;
      ball.sphere.material.needsUpdate = true;
      ball.label.material.map = this.labelTexture(
        ball.wild ? "×2" : formatRank(rank),
      );
    }
    const r = radiusOfRank(rank);
    ball.group.position.set(pose.x, pose.y, pose.z);
    ball.sphere.quaternion.set(pose.qx, pose.qy, pose.qz, pose.qw);
    ball.sphere.scale.setScalar(r * pulse);
    ball.shadow.position.set(pose.x, 0.024, pose.z);
    const height = Math.max(0, pose.y - r);
    ball.shadow.scale.setScalar(r * 3.1 + height * 0.3);
    ball.shadow.visible = pose.y > -1 && height < 5;
  }
  render(sim: Simulation, dt: number, time: number) {
    if (this.origin !== sim.physics.origin) {
      this.clearParticles();
      this.origin = sim.physics.origin;
    }
    this.sync(sim);
    this.water.uniforms.time.value = time;
    const pose = sim.physics.pose();
    this.pulse = Math.max(0, this.pulse - dt);
    this.shake = Math.max(0, this.shake - dt);
    const h = this.renderer.domElement.clientHeight,
      readyLook =
        this.camera.aspect < 0.8
          ? Math.max(-3, Math.min(2.3, (h - 667) / 90 - 1))
          : 7;
    const wantedLook = sim.phase === "ready" ? readyLook : 7;
    this.cameraLook +=
      (wantedLook - this.cameraLook) *
      (this.reducedMotion ? 1 : 1 - Math.exp(-dt * 8));
    this.camera.position.set(
      pose.x * 0.18,
      10.8 + Math.max(0, pose.y - sim.physics.radius) * 0.25,
      pose.z + 10.5,
    );
    if (!this.reducedMotion && this.shake > 0)
      this.camera.position.x += Math.sin(time * 85) * this.shake * 0.4;
    this.camera.lookAt(pose.x * 0.1, 0.2, pose.z - this.cameraLook);
    this.sea.position.z = pose.z - 20;
    this.updateBall(
      this.player,
      pose,
      sim.rank,
      1 +
        (this.reducedMotion
          ? 0
          : Math.sin((this.pulse / 0.3) * Math.PI) * 0.13),
    );
    for (const [id, ball] of this.balls) {
      const p = sim.physics.objectPose(id);
      if (p) {
        ball.group.visible = p.z < pose.z + 8 && p.z > pose.z - 95;
        this.updateBall(ball, p, ball.rank);
        ball.shadow.visible &&= ball.group.visible;
      }
    }
    for (const [id, group] of this.obstacles) {
      const p = sim.physics.objectPose(id);
      if (p) {
        group.position.set(p.x, p.y, p.z);
        group.visible = p.z < pose.z + 8 && p.z > pose.z - 95;
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.velocity.y -= dt * 8;
      p.mesh.position.addScaledVector(p.velocity, dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        p.life,
      );
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }
}
