import RAPIER from "@dimforge/rapier3d-compat";
import {
  radiusOfRank,
  type Chunk,
  type CourseObject,
  type Surface,
} from "./course";
export const STEP = 1 / 120;
export interface Pose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}
interface PhysicalObject {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  object: CourseObject;
}
export class Physics {
  readonly world = new RAPIER.World({ x: 0, y: -18, z: 0 });
  readonly player: RAPIER.RigidBody;
  private readonly playerCollider: RAPIER.Collider;
  private readonly queue = new RAPIER.EventQueue(true);
  private readonly objects = new Map<number, PhysicalObject>();
  private readonly colliderIds = new Map<number, number>();
  private readonly ground = new Map<number, number>();
  private readonly chunkBodies = new Map<number, RAPIER.RigidBody[]>();
  grounded = true;
  radius: number;
  origin = 0;
  constructor(rank: number) {
    this.world.timestep = STEP;
    this.world.numSolverIterations = 8;
    this.radius = radiusOfRank(rank);
    this.player = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, this.radius + 0.04, 0)
        .setLinearDamping(0.12)
        .setAngularDamping(0.12)
        .setCanSleep(false)
        .setCcdEnabled(true),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(this.radius)
        .setDensity(1.4)
        .setFriction(0.8)
        .setRestitution(0.18)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.player,
    );
  }
  static async init() {
    await RAPIER.init();
  }
  get size() {
    return this.world.bodies.len();
  }
  pose(body = this.player): Pose {
    const p = body.translation(),
      q = body.rotation();
    return { x: p.x, y: p.y, z: p.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w };
  }
  objectPose(id: number) {
    const object = this.objects.get(id);
    return object ? this.pose(object.body) : null;
  }
  velocity() {
    return this.player.linvel();
  }
  addChunk(chunk: Chunk) {
    const bodies: RAPIER.RigidBody[] = [];
    this.chunkBodies.set(chunk.id, bodies);
    for (const s of chunk.surfaces) this.addSurface(s, bodies);
    for (const object of chunk.objects) {
      const isBall = object.kind === "ball" || object.kind === "wild",
        radius = radiusOfRank(object.rank);
      const desc = isBall
        ? RAPIER.RigidBodyDesc.dynamic()
            .setLinearDamping(0.6)
            .setAngularDamping(0.3)
            .setCcdEnabled(true)
        : object.kind === "bumper"
          ? RAPIER.RigidBodyDesc.kinematicPositionBased()
          : RAPIER.RigidBodyDesc.fixed();
      const y = isBall
        ? radius + 0.02
        : object.kind === "jump"
          ? this.heightAt(chunk, object.distance) + 0.07
          : object.kind === "spike"
            ? 0.28
            : 1.15;
      const body = this.world.createRigidBody(
        desc.setTranslation(object.x, y, this.origin - object.distance),
      );
      let collider: RAPIER.ColliderDesc;
      if (isBall)
        collider = RAPIER.ColliderDesc.ball(radius)
          .setDensity(0.7)
          .setFriction(0.6)
          .setRestitution(0.25);
      else if (object.kind === "spike")
        collider = RAPIER.ColliderDesc.cuboid(
          object.width,
          0.28,
          0.43,
        ).setSensor(true);
      else if (object.kind === "jump")
        collider = RAPIER.ColliderDesc.cuboid(
          object.width,
          0.13,
          0.48,
        ).setSensor(true);
      else
        collider = RAPIER.ColliderDesc.cylinder(1.15, object.width)
          .setFriction(0.25)
          .setRestitution(0.55);
      collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
      const shape = this.world.createCollider(collider, body);
      this.objects.set(object.id, { body, collider: shape, object });
      this.colliderIds.set(shape.handle, object.id);
    }
  }
  private heightAt(chunk: Chunk, d: number) {
    const s = chunk.surfaces.find((s) => d >= s.start && d <= s.end);
    return s ? s.h0 + ((s.h1 - s.h0) * (d - s.start)) / (s.end - s.start) : 0;
  }
  private addSurface(s: Surface, bodies: RAPIER.RigidBody[]) {
    const length = s.end - s.start,
      angle = Math.atan2(s.h1 - s.h0, length);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(
          s.x,
          (s.h0 + s.h1) / 2 - 0.12 / Math.cos(angle),
          this.origin - (s.start + s.end) / 2,
        )
        .setRotation({
          x: Math.sin(angle / 2),
          y: 0,
          z: 0,
          w: Math.cos(angle / 2),
        }),
    );
    const floor = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        s.width / 2,
        0.12,
        Math.hypot(length, s.h1 - s.h0) / 2,
      )
        .setFriction(s.friction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0.1),
      body,
    );
    this.ground.set(floor.handle, s.friction);
    bodies.push(body);
    if (s.rails)
      for (const sign of [-1, 1])
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.16, 0.035, length / 2)
            .setTranslation(sign * (s.width / 2 + 0.16), 0.155, 0)
            .setFriction(0.15)
            .setRestitution(0.45),
          body,
        );
  }
  removeObject(id: number) {
    const o = this.objects.get(id);
    if (!o) return;
    this.colliderIds.delete(o.collider.handle);
    this.world.removeRigidBody(o.body);
    this.objects.delete(id);
  }
  removeChunk(chunk: Chunk) {
    for (const o of chunk.objects) this.removeObject(o.id);
    for (const body of this.chunkBodies.get(chunk.id) ?? []) {
      for (let i = 0; i < body.numColliders(); i++)
        this.ground.delete(body.collider(i).handle);
      this.world.removeRigidBody(body);
    }
    this.chunkBodies.delete(chunk.id);
  }
  resize(rank: number) {
    const radius = radiusOfRank(rank),
      difference = radius - this.radius,
      p = this.player.translation();
    this.playerCollider.setRadius(radius);
    this.player.recomputeMassPropertiesFromColliders();
    if (difference > 0)
      this.player.setTranslation({ x: p.x, y: p.y + difference, z: p.z }, true);
    this.radius = radius;
  }
  repel(id: number) {
    const object = this.objects.get(id);
    if (!object) return;
    const p = this.player.translation(),
      other = object.body.translation();
    let dx = other.x - p.x;
    if (Math.abs(dx) < 0.3) dx = (other.x < 0 ? -1 : 1) * 0.65;
    const dz = other.z - p.z;
    const length = Math.hypot(dx, dz) || 1;
    const playerMass = this.player.mass(),
      objectMass = object.body.mass();
    const impulse = ((playerMass * objectMass) / (playerMass + objectMass)) * 9;
    const x = (dx / length) * impulse,
      z = (dz / length) * impulse;
    object.body.applyImpulse({ x, y: objectMass * 2.8, z }, true);
    this.player.applyImpulse({ x: -x, y: playerMass * 0.6, z: -z }, true);
  }
  jump(speed: number) {
    const v = this.velocity(),
      m = this.player.mass();
    this.player.applyImpulse(
      { x: 0, y: m * Math.max(0, 9.5 - v.y), z: m * (-speed * 1.2 - v.z) },
      true,
    );
  }
  hurt(direction: number) {
    const m = this.player.mass();
    this.player.applyImpulse(
      { x: direction * m * 1.9, y: m * 1.8, z: m * 1.4 },
      true,
    );
  }
  step(targetX: number, speed: number, time: number): number[] {
    const p = this.player.translation(),
      v = this.player.linvel(),
      m = this.player.mass();
    const ray = this.world.castRay(
      new RAPIER.Ray(p, { x: 0, y: -1, z: 0 }),
      this.radius + 0.13,
      true,
      undefined,
      undefined,
      this.playerCollider,
      this.player,
      (c) => this.ground.has(c.handle),
    );
    this.grounded = ray !== null;
    const friction = ray
      ? (this.ground.get(ray.collider.handle) ?? 0.65)
      : 0.05;
    const grip = this.grounded ? (friction < 0.15 ? 0.24 : 1) : 0.15;
    const icy = this.grounded && friction < 0.15;
    const wantedX = Math.max(-7, Math.min(7, (targetX - p.x) * (icy ? 4 : 7))),
      ax =
        Math.max(-42, Math.min(42, (wantedX - v.x * (icy ? 2.5 : 1)) * 11)) *
        grip,
      az = this.grounded ? Math.max(-24, Math.min(24, (-speed - v.z) * 9)) : 0;
    this.player.resetForces(true);
    this.player.resetTorques(true);
    this.player.addForce({ x: ax * m, y: 0, z: az * m }, true);
    if (this.grounded) {
      const a = this.player.angvel(),
        inertia = 0.4 * m * this.radius * this.radius;
      this.player.addTorque(
        {
          x: (v.z / this.radius - a.x) * inertia * 5,
          y: -a.y * inertia,
          z: (-v.x / this.radius - a.z) * inertia * 5,
        },
        true,
      );
    }
    for (const { body, object: o } of this.objects.values())
      if (o.kind === "bumper")
        body.setNextKinematicTranslation({
          x:
            o.x +
            Math.sin(time * (o.frequency ?? 1.6) + o.id) * (o.travel ?? 2.3),
          y: 1.15,
          z: this.origin - o.distance,
        });
    this.world.step(this.queue);
    const contacts: number[] = [];
    this.queue.drainCollisionEvents((a, b, started) => {
      if (!started) return;
      const handle =
        a === this.playerCollider.handle
          ? b
          : b === this.playerCollider.handle
            ? a
            : null;
      if (handle !== null) {
        const id = this.colliderIds.get(handle);
        if (id !== undefined) contacts.push(id);
      }
    });
    return contacts;
  }
  rebase(distance: number) {
    if (distance - this.origin < 256) return;
    this.origin += 256;
    this.world.forEachRigidBody((body) => {
      const p = body.translation();
      body.setTranslation({ x: p.x, y: p.y, z: p.z + 256 }, false);
    });
  }
  dispose() {
    this.queue.free();
    this.world.free();
  }
}
