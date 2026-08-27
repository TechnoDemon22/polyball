import type { Vec2 } from '@polyball/shared';

/**
 * Tiny fixed-capacity particle system for hit sparks, damage rings and the ball
 * trail. Everything is allocated up front so a long match never triggers a GC
 * pause mid-rally.
 */

export interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

export interface Ring {
  active: boolean;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  growth: number;
  color: string;
  width: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  age: number;
}

const MAX_PARTICLES = 220;
const MAX_RINGS = 24;
const MAX_TRAIL = 26;

export class Effects {
  readonly particles: Particle[] = Array.from({ length: MAX_PARTICLES }, () => ({
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 2,
    color: '#fff',
  }));

  readonly rings: Ring[] = Array.from({ length: MAX_RINGS }, () => ({
    active: false,
    x: 0,
    y: 0,
    life: 0,
    maxLife: 1,
    radius: 0,
    growth: 0,
    color: '#fff',
    width: 2,
  }));

  readonly trail: TrailPoint[] = [];

  /** Screen shake amount in world units, decaying over time. */
  shake = 0;

  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  clear(): void {
    for (const particle of this.particles) particle.active = false;
    for (const ring of this.rings) ring.active = false;
    this.trail.length = 0;
    this.shake = 0;
  }

  private freeParticle(): Particle | null {
    for (const particle of this.particles) if (!particle.active) return particle;
    return null;
  }

  private freeRing(): Ring | null {
    for (const ring of this.rings) if (!ring.active) return ring;
    return null;
  }

  burst(at: Vec2, color: string, count = 12, speed = 240): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i += 1) {
      const particle = this.freeParticle();
      if (!particle) return;
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const magnitude = speed * (0.4 + Math.random() * 0.8);
      particle.active = true;
      particle.x = at.x;
      particle.y = at.y;
      particle.vx = Math.cos(angle) * magnitude;
      particle.vy = Math.sin(angle) * magnitude;
      particle.maxLife = 0.35 + Math.random() * 0.35;
      particle.life = particle.maxLife;
      particle.size = 2 + Math.random() * 3;
      particle.color = color;
    }
  }

  ring(at: Vec2, color: string, radius = 10, growth = 420, width = 3, life = 0.5): void {
    if (!this.enabled) return;
    const entry = this.freeRing();
    if (!entry) return;
    entry.active = true;
    entry.x = at.x;
    entry.y = at.y;
    entry.radius = radius;
    entry.growth = growth;
    entry.color = color;
    entry.width = width;
    entry.maxLife = life;
    entry.life = life;
  }

  kick(amount: number): void {
    if (!this.enabled) return;
    this.shake = Math.min(26, this.shake + amount);
  }

  pushTrail(at: Vec2): void {
    if (!this.enabled) return;
    this.trail.push({ x: at.x, y: at.y, age: 0 });
    while (this.trail.length > MAX_TRAIL) this.trail.shift();
  }

  update(dt: number): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 1 - 2.4 * dt;
      particle.vy *= 1 - 2.4 * dt;
    }

    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.life -= dt;
      if (ring.life <= 0) {
        ring.active = false;
        continue;
      }
      ring.radius += ring.growth * dt;
    }

    for (const point of this.trail) point.age += dt;
    while (this.trail.length > 0 && this.trail[0].age > 0.32) this.trail.shift();

    this.shake = Math.max(0, this.shake - this.shake * 6 * dt - 6 * dt);
  }
}
