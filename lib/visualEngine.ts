import * as THREE from "three";
import { getInstrumentForY, INSTRUMENT_COLORS } from "./musicMapping";
import type { NoteEvent } from "./eventListener";

interface Ripple {
  theta: number; // polar angle on sphere
  phi: number;   // azimuthal angle on sphere
  intensity: number;
  age: number;
  color: THREE.Color;
}

interface Particle {
  mesh: THREE.Points;
  velocities: Float32Array;
  lifetimes: Float32Array;
  age: number;
}

const SPHERE_RADIUS = 15;

export class DriftVisualEngine {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private nebulaMesh!: THREE.Mesh;
  private nebulaMaterial!: THREE.ShaderMaterial;

  private ripples: Ripple[] = [];
  private particles: Particle[] = [];
  private startTime = Date.now();
  private animationId: number | null = null;
  private globalIntensity = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.initScene();
    this.initNebula();
  }

  private initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030008);

    this.camera = new THREE.PerspectiveCamera(
      55,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      500
    );
    this.camera.position.set(0, 0, 45);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    window.addEventListener("resize", this.onResize);
  }

  private initNebula() {
    const geometry = new THREE.SphereGeometry(SPHERE_RADIUS, 256, 256);

    this.nebulaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGlobalIntensity: { value: 0 },
        // 8 ripples × 4 floats: theta, phi, intensity, age
        uRipples: { value: new Float32Array(32) },
        uNoteColors: { value: Array(8).fill(new THREE.Color(0x000000)) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uRipples[32];
        uniform float uGlobalIntensity;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;

        // 2D simplex noise for vertex displacement
        vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289v3(((x * 34.0) + 1.0) * x); }
        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
          vec2 i = floor(v + dot(v, C.yy));
          vec2 x0 = v - i + dot(i, C.xx);
          vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289v2(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
          m = m*m; m = m*m;
          vec3 x3 = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x3) - 0.5;
          vec3 ox = floor(x3 + 0.5);
          vec3 a0 = x3 - ox;
          m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
          vec3 g;
          g.x = a0.x * x0.x + h.x * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          vec3 pos = position;
          vec3 n = normalize(position);

          // Spherical coords of this vertex
          float theta = acos(clamp(n.y, -1.0, 1.0));
          float phi = atan(n.z, n.x);

          // Gentle surface breathing
          float breath = snoise(vec2(theta * 2.0 + uTime * 0.15, phi * 2.0 + uTime * 0.1)) * 0.15;
          breath += snoise(vec2(theta * 4.0 - uTime * 0.2, phi * 3.0 + uTime * 0.12)) * 0.08;
          float displacement = breath * (1.0 + uGlobalIntensity * 2.0);

          // Ripple eruptions — push outward along normal
          for (int i = 0; i < 8; i++) {
            int idx = i * 4;
            float rTheta = uRipples[idx];
            float rPhi   = uRipples[idx + 1];
            float intensity = uRipples[idx + 2];
            float age = uRipples[idx + 3];

            if (intensity > 0.0) {
              // Angular distance on sphere surface
              float cosAngle = sin(theta)*sin(rTheta)*cos(phi - rPhi) + cos(theta)*cos(rTheta);
              float angDist = acos(clamp(cosAngle, -1.0, 1.0));

              // Expanding ring wavefront + central bulge
              float ringRadius = age * 0.6;
              float ring = exp(-pow(angDist - ringRadius, 2.0) * 40.0) * intensity;
              float bulge = exp(-angDist * angDist * 15.0) * intensity * exp(-age * 0.5);
              displacement += (ring * 0.8 + bulge * 1.5) * exp(-age * 0.3);
            }
          }

          pos = n * (${SPHERE_RADIUS.toFixed(1)} + displacement);
          vPosition = pos;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uGlobalIntensity;
        uniform vec3 uNoteColors[8];
        uniform float uRipples[32];
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying vec2 vUv;

        vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec3 permute(vec3 x) { return mod289v3(((x * 34.0) + 1.0) * x); }

        float snoise(vec2 v) {
          const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
          vec2 i = floor(v + dot(v, C.yy));
          vec2 x0 = v - i + dot(i, C.xx);
          vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
          vec4 x12 = x0.xyxy + C.xxzz;
          x12.xy -= i1;
          i = mod289v2(i);
          vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
          vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
          m = m*m; m = m*m;
          vec3 x3 = 2.0 * fract(p * C.www) - 1.0;
          vec3 h = abs(x3) - 0.5;
          vec3 ox = floor(x3 + 0.5);
          vec3 a0 = x3 - ox;
          m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
          vec3 g;
          g.x = a0.x * x0.x + h.x * x0.y;
          g.yz = a0.yz * x12.xz + h.yz * x12.yw;
          return 130.0 * dot(m, g);
        }

        float fbm(vec2 p) {
          float v = 0.0; float a = 0.5; float f = 1.0;
          for (int i = 0; i < 5; i++) { v += a * snoise(p * f); f *= 2.0; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 n = normalize(vPosition);
          float theta = acos(clamp(n.y, -1.0, 1.0));
          float phi = atan(n.z, n.x);
          float t = uTime * 0.04;

          // Swirling nebula surface noise
          vec2 sp = vec2(theta * 1.8, phi * 1.8);
          float n1 = fbm(sp + vec2(t * 0.3, t * 0.2));
          float n2 = fbm(sp * 1.5 + vec2(-t * 0.2, t * 0.35) + n1 * 0.4);
          float n3 = fbm(sp * 0.8 + vec2(t * 0.15, -t * 0.25) + n2 * 0.3);

          // Soothing palette
          vec3 deepPurple   = vec3(0.10, 0.04, 0.22);
          vec3 brightPurple = vec3(0.38, 0.18, 0.58);
          vec3 tealGlow     = vec3(0.10, 0.35, 0.50);
          vec3 softPink     = vec3(0.50, 0.22, 0.48);
          vec3 warmLavender = vec3(0.32, 0.24, 0.52);
          vec3 hotCore      = vec3(1.0, 0.6, 0.3);

          float b1 = smoothstep(-0.5, 0.5, n1);
          float b2 = smoothstep(-0.3, 0.6, n2);
          float b3 = smoothstep(-0.4, 0.4, n3);

          vec3 color = mix(deepPurple, brightPurple, b1);
          color = mix(color, tealGlow, b2 * 0.4);
          color = mix(color, softPink, b3 * 0.35);
          color = mix(color, warmLavender, smoothstep(0.2, 0.8, n1 * n2) * 0.3);

          // Fresnel rim glow — brighter edges like a star's corona
          vec3 viewDir = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 3.0);
          color += vec3(0.3, 0.15, 0.55) * fresnel * 1.2;

          // Transaction ripple eruptions on the sphere surface
          for (int i = 0; i < 8; i++) {
            int idx = i * 4;
            float rTheta = uRipples[idx];
            float rPhi   = uRipples[idx + 1];
            float intensity = uRipples[idx + 2];
            float age = uRipples[idx + 3];

            if (intensity > 0.0) {
              float cosAngle = sin(theta)*sin(rTheta)*cos(phi - rPhi) + cos(theta)*cos(rTheta);
              float angDist = acos(clamp(cosAngle, -1.0, 1.0));

              // Expanding bright ring
              float ringRadius = age * 0.6;
              float ring = exp(-pow(angDist - ringRadius, 2.0) * 35.0) * intensity * exp(-age * 0.25);

              // Central eruption glow
              float glow = exp(-angDist * angDist * 12.0) * intensity * exp(-age * 0.35);

              // Hot bright core fading to note color
              vec3 eruptColor = mix(hotCore, uNoteColors[i], smoothstep(0.0, 2.0, age));
              color += eruptColor * (ring * 1.2 + glow * 1.5);
            }
          }

          // Global intensity brightens entire sphere
          color *= (1.0 + uGlobalIntensity * 1.8);

          // Subtle ambient color bleed from active notes
          for (int i = 0; i < 8; i++) {
            color = mix(color, uNoteColors[i] * 0.5, uGlobalIntensity * 0.04);
          }

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: false,
    });

    this.nebulaMesh = new THREE.Mesh(geometry, this.nebulaMaterial);
    this.scene.add(this.nebulaMesh);
  }

  createRipple(event: NoteEvent) {
    const instrument = getInstrumentForY(event.y);
    const colorHex = INSTRUMENT_COLORS[instrument];
    const color = new THREE.Color(colorHex);

    // Map event x/y (-1000..+1000) to spherical coords
    const theta = ((event.y + 1000) / 2000) * Math.PI;       // 0..π
    const phi = ((event.x + 1000) / 2000) * Math.PI * 2 - Math.PI; // -π..π

    if (this.ripples.length >= 8) {
      this.ripples.shift();
    }
    this.ripples.push({ theta, phi, intensity: 2.5, age: 0, color });

    this.globalIntensity = Math.min(this.globalIntensity + 0.35, 1.0);

    // Spawn particles outward from the sphere surface
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    const sx = SPHERE_RADIUS * sinT * cosP;
    const sy = SPHERE_RADIUS * cosT;
    const sz = SPHERE_RADIUS * sinT * sinP;
    this.spawnParticles(sx, sy, sz, color, 0.8);
  }

  private spawnParticles(sx: number, sy: number, sz: number, color: THREE.Color, intensity: number) {
    const count = Math.floor(15 + intensity * 35);
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);

    // Normal direction (outward from sphere center)
    const nx = sx / SPHERE_RADIUS;
    const ny = sy / SPHERE_RADIUS;
    const nz = sz / SPHERE_RADIUS;

    for (let i = 0; i < count; i++) {
      positions[i * 3] = sx + (Math.random() - 0.5) * 1.5;
      positions[i * 3 + 1] = sy + (Math.random() - 0.5) * 1.5;
      positions[i * 3 + 2] = sz + (Math.random() - 0.5) * 1.5;

      // Velocity: mostly outward with some spread
      const speed = 1.5 + Math.random() * 4;
      const spread = 0.4;
      velocities[i * 3] = nx * speed + (Math.random() - 0.5) * spread;
      velocities[i * 3 + 1] = ny * speed + (Math.random() - 0.5) * spread;
      velocities[i * 3 + 2] = nz * speed + (Math.random() - 0.5) * spread;

      lifetimes[i] = 1.5 + Math.random() * 2.5;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color,
      size: 0.25,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    this.scene.add(points);
    this.particles.push({ mesh: points, velocities, lifetimes, age: 0 });
  }

  startRenderLoop() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate);
      const elapsed = (Date.now() - this.startTime) / 1000;

      this.nebulaMaterial.uniforms.uTime.value = elapsed;
      this.nebulaMaterial.uniforms.uGlobalIntensity.value = this.globalIntensity;

      // Update ripple uniforms
      const rippleData = new Float32Array(32);
      const noteColors: THREE.Color[] = [];
      for (let i = 0; i < 8; i++) {
        if (i < this.ripples.length) {
          const r = this.ripples[i];
          r.age += 0.016;
          rippleData[i * 4] = r.theta;
          rippleData[i * 4 + 1] = r.phi;
          rippleData[i * 4 + 2] = r.intensity * Math.exp(-r.age * 0.25);
          rippleData[i * 4 + 3] = r.age;
          noteColors.push(r.color);
        } else {
          noteColors.push(new THREE.Color(0x000000));
        }
      }
      this.nebulaMaterial.uniforms.uRipples.value = rippleData;
      this.nebulaMaterial.uniforms.uNoteColors.value = noteColors;

      this.ripples = this.ripples.filter((r) => r.age < 8);

      this.globalIntensity *= 0.97;

      // Update particles — drift outward then fade
      const dt = 0.016;
      this.particles = this.particles.filter((p) => {
        p.age += dt;
        const posAttr = p.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        const positions = posAttr.array as Float32Array;
        let alive = false;

        for (let i = 0; i < p.lifetimes.length; i++) {
          if (p.age < p.lifetimes[i]) {
            alive = true;
            positions[i * 3] += p.velocities[i * 3] * dt;
            positions[i * 3 + 1] += p.velocities[i * 3 + 1] * dt;
            positions[i * 3 + 2] += p.velocities[i * 3 + 2] * dt;
            // Gentle deceleration (no gravity — space)
            p.velocities[i * 3] *= 0.995;
            p.velocities[i * 3 + 1] *= 0.995;
            p.velocities[i * 3 + 2] *= 0.995;
          }
        }
        posAttr.needsUpdate = true;

        const mat = p.mesh.material as THREE.PointsMaterial;
        mat.opacity = Math.max(0, 0.9 * (1 - p.age / 3.5));

        if (!alive || p.age > 5) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          mat.dispose();
          return false;
        }
        return true;
      });

      this.animateCamera(elapsed);
      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  private animateCamera(time: number) {
    const radius = 42 + Math.sin(time * 0.08) * 4;
    const angle = time * 0.04;
    const height = Math.sin(time * 0.12) * 8;

    this.camera.position.x = Math.sin(angle) * radius;
    this.camera.position.z = Math.cos(angle) * radius;
    this.camera.position.y = height;
    this.camera.lookAt(0, 0, 0);
  }

  private onResize = () => {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.onResize);
    this.particles.forEach((p) => {
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.PointsMaterial).dispose();
    });
    this.nebulaMesh.geometry.dispose();
    this.nebulaMaterial.dispose();
    this.renderer.dispose();
  }
}
