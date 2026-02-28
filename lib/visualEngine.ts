import * as THREE from "three";
import { getInstrumentForY, INSTRUMENT_COLORS } from "./musicMapping";
import type { NoteEvent } from "./eventListener";

interface Ripple {
  x: number;
  z: number;
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

export class DriftVisualEngine {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private oceanMesh!: THREE.Mesh;
  private oceanMaterial!: THREE.ShaderMaterial;

  private ripples: Ripple[] = [];
  private particles: Particle[] = [];
  private startTime = Date.now();
  private animationId: number | null = null;
  private globalIntensity = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.initScene();
    this.initOcean();
  }

  private initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    this.scene.fog = new THREE.FogExp2(0x050510, 0.002);

    this.camera = new THREE.PerspectiveCamera(
      60,
      this.canvas.clientWidth / this.canvas.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 30, 50);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambientLight = new THREE.AmbientLight(0x111133, 0.5);
    const directionalLight = new THREE.DirectionalLight(0x4444ff, 0.3);
    directionalLight.position.set(0, 50, 50);
    this.scene.add(ambientLight, directionalLight);

    window.addEventListener("resize", this.onResize);
  }

  private initOcean() {
    const geometry = new THREE.PlaneGeometry(200, 200, 128, 128);
    geometry.rotateX(-Math.PI / 2);

    this.oceanMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGlobalIntensity: { value: 0 },
        uRipples: { value: new Float32Array(32) }, // 8 ripples × 4 values
        uNoteColors: { value: Array(8).fill(new THREE.Color(0x050510)) },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uRipples[32];
        uniform float uGlobalIntensity;
        varying vec2 vUv;
        varying float vElevation;

        void main() {
          vUv = uv;
          vec3 pos = position;

          // Base ocean waves
          float wave1 = sin(pos.x * 0.3 + uTime * 0.5) * 0.5;
          float wave2 = sin(pos.z * 0.2 + uTime * 0.3) * 0.3;
          float wave3 = sin((pos.x + pos.z) * 0.15 + uTime * 0.7) * 0.4;
          float baseWave = (wave1 + wave2 + wave3) * (0.5 + uGlobalIntensity * 1.5);

          // Note ripples
          float rippleSum = 0.0;
          for (int i = 0; i < 8; i++) {
            int idx = i * 4;
            float rx = uRipples[idx];
            float rz = uRipples[idx + 1];
            float intensity = uRipples[idx + 2];
            float age = uRipples[idx + 3];

            if (intensity > 0.0) {
              float dist = distance(pos.xz, vec2(rx, rz));
              float ripple = sin(dist * 3.0 - age * 8.0) * intensity * exp(-dist * 0.1) * exp(-age * 0.5);
              rippleSum += ripple;
            }
          }

          pos.y += baseWave + rippleSum;
          vElevation = pos.y;

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uGlobalIntensity;
        uniform vec3 uNoteColors[8];
        varying vec2 vUv;
        varying float vElevation;

        void main() {
          vec3 deepColor = vec3(0.02, 0.02, 0.08);
          vec3 surfaceColor = vec3(0.05, 0.15, 0.3);
          vec3 highlightColor = vec3(0.1, 0.4, 0.6);

          float normalizedElev = smoothstep(-2.0, 3.0, vElevation);
          vec3 color = mix(deepColor, surfaceColor, normalizedElev);
          color = mix(color, highlightColor, smoothstep(0.6, 1.0, normalizedElev));

          // Blend note colors
          for (int i = 0; i < 8; i++) {
            color = mix(color, uNoteColors[i], uGlobalIntensity * 0.15);
          }

          // Fresnel-like edge glow
          float fresnel = pow(1.0 - normalizedElev, 3.0) * 0.3;
          color += vec3(0.1, 0.2, 0.5) * fresnel;

          gl_FragColor = vec4(color, 0.95);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });

    this.oceanMesh = new THREE.Mesh(geometry, this.oceanMaterial);
    this.scene.add(this.oceanMesh);
  }

  createRipple(event: NoteEvent) {
    const instrument = getInstrumentForY(event.y);
    const colorHex = INSTRUMENT_COLORS[instrument];
    const color = new THREE.Color(colorHex);

    // Map event coordinates to ocean surface coordinates
    const oceanX = (event.x / 1000) * 80; // -80 to +80
    const oceanZ = (event.y / 1000) * 80;

    // Add ripple (circular buffer of 8)
    if (this.ripples.length >= 8) {
      this.ripples.shift();
    }
    this.ripples.push({ x: oceanX, z: oceanZ, intensity: 2.0, age: 0, color });

    // Increase global intensity briefly
    this.globalIntensity = Math.min(this.globalIntensity + 0.15, 1.0);

    // Spawn particles
    this.spawnParticles(oceanX, oceanZ, color, 0.7);
  }

  private spawnParticles(x: number, z: number, color: THREE.Color, intensity: number) {
    const count = Math.floor(10 + intensity * 30);
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = x + (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 2;

      velocities[i * 3] = (Math.random() - 0.5) * 2;
      velocities[i * 3 + 1] = 2 + Math.random() * 4;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;

      lifetimes[i] = 1.0 + Math.random() * 2.0;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color,
      size: 0.3,
      transparent: true,
      opacity: 0.8,
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

      // Update ocean shader uniforms
      this.oceanMaterial.uniforms.uTime.value = elapsed;
      this.oceanMaterial.uniforms.uGlobalIntensity.value = this.globalIntensity;

      // Update ripple uniforms
      const rippleData = new Float32Array(32);
      const noteColors: THREE.Color[] = [];
      for (let i = 0; i < 8; i++) {
        if (i < this.ripples.length) {
          const r = this.ripples[i];
          r.age += 0.016; // ~60fps
          rippleData[i * 4] = r.x;
          rippleData[i * 4 + 1] = r.z;
          rippleData[i * 4 + 2] = r.intensity * Math.exp(-r.age * 0.3);
          rippleData[i * 4 + 3] = r.age;
          noteColors.push(r.color);
        } else {
          noteColors.push(new THREE.Color(0x050510));
        }
      }
      this.oceanMaterial.uniforms.uRipples.value = rippleData;
      this.oceanMaterial.uniforms.uNoteColors.value = noteColors;

      // Remove old ripples
      this.ripples = this.ripples.filter((r) => r.age < 6);

      // Decay global intensity
      this.globalIntensity *= 0.98;

      // Update particles
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
            p.velocities[i * 3 + 1] -= 2 * dt; // gravity
          }
        }
        posAttr.needsUpdate = true;

        const mat = p.mesh.material as THREE.PointsMaterial;
        mat.opacity = Math.max(0, 0.8 * (1 - p.age / 3));

        if (!alive || p.age > 4) {
          this.scene.remove(p.mesh);
          p.mesh.geometry.dispose();
          mat.dispose();
          return false;
        }
        return true;
      });

      // Camera orbit
      this.animateCamera(elapsed);

      this.renderer.render(this.scene, this.camera);
    };

    animate();
  }

  private animateCamera(time: number) {
    const radius = 55 + Math.sin(time * 0.1) * 10;
    const angle = time * 0.05;
    const height = 30 + Math.sin(time * 0.2) * 5;

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
    this.oceanMesh.geometry.dispose();
    this.oceanMaterial.dispose();
    this.renderer.dispose();
  }
}
