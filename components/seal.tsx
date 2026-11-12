"use client";

// The site seal, drawn after the 1994 CIA server page: a navy ring with white lettering over the
// top, a plain gold lower band, a white field, and a shield with a red compass star.
// It is an original emblem for Builders Marketplace, not a copy of any government seal.
//
// `SealMark` is the small flat SVG used inside the index banners; it never touches three.js.
// `Seal` is the masthead emblem. It builds the emblem in three.js on the client and spins it
// around its vertical axis only while a listing page is open, holding still on a project page.
// The navy ring, gold band and gold outlines are real `MeshStandardMaterial` meshes under an
// environment map, so they catch light and read metallic; the lettering, hammer, shield and
// compass star are painted into a transparent canvas texture laid over the metal. The ring label is
// rasterized from the SAME `<textPath>` SVG the flat fallback uses, so the browser lays it out
// identically (correct arc, un-mirrored on the front).
// The coin body is a flat cylinder whose circular face turns toward the camera, so it reads as a
// coin with a thin edge instead of a blue bar. On a server render (or a browser without WebGL)
// the flat, white-backed SVG is shown instead, so the masthead never flashes empty.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const NAVY = "#1b2a5c";
const GOLD = "#d4a017";
const RED = "#c8102e";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// A 16-point compass star: points alternate between the outer and inner radius.
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  return Array.from({ length: 32 }, (_, i) => {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / 16 - Math.PI / 2;
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

export function SealMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="seal-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <circle cx="20" cy="20" r="19" fill={NAVY} stroke={GOLD} strokeWidth="1.5" />
      <circle cx="20" cy="20" r="12" fill="#ffffff" stroke={GOLD} strokeWidth="1" />
      <polygon points={starPoints(20, 20, 10, 3.5)} fill={RED} />
    </svg>
  );
}

// Flat server/fallback render. A white 150x150 plate (matching the page background) replaces the
// old light-grey square.
function FlatSeal() {
  return (
    <svg viewBox="0 0 150 150" role="img" aria-label="Seal of the Builders Marketplace">
      <rect width="150" height="150" fill="#ffffff" />
      <defs>
        {/* Top arc, left to right over the top; glyphs grow outward from radius 60. It carries the
            full name, so it spans the whole 180-degree top half of the ring. */}
        <path id="seal-top-arc" d="M 15 75 A 60 60 0 0 1 135 75" />
      </defs>

      <circle cx="75" cy="75" r="72" fill={NAVY} />
      {/* Gold lower band: a thick arc spanning 140 degrees across the bottom of the ring. */}
      <path d="M 17.68 95.86 A 61 61 0 0 0 132.32 95.86" fill="none" stroke={GOLD} strokeWidth="18" />
      <circle cx="75" cy="75" r="72" fill="none" stroke={GOLD} strokeWidth="1.5" />
      <circle cx="75" cy="75" r="52" fill="#ffffff" stroke={GOLD} strokeWidth="1.5" />

      <text fill="#ffffff" fontFamily="Times, 'Times New Roman', serif" fontSize="12" fontWeight="700" letterSpacing="1">
        <textPath href="#seal-top-arc" startOffset="50%" textAnchor="middle">
          BUILDERS MARKETPLACE
        </textPath>
      </text>

      {/* A claw hammer stands where the reference has the eagle's head. */}
      <rect x="61" y="31" width="28" height="7" fill="#3a3a3a" />
      <rect x="72" y="38" width="6" height="14" fill="#8b5a2b" />

      <path d="M 55 54 H 95 V 78 Q 95 100 75 110 Q 55 100 55 78 Z" fill={NAVY} stroke={GOLD} strokeWidth="1.5" />
      <polygon points={starPoints(75, 79, 17, 6)} fill={RED} stroke="#ffffff" strokeWidth="0.6" />
    </svg>
  );
}

// The top ring label, as an SVG fragment. This is byte-for-byte the same <textPath> element
// as FlatSeal, which is the single source of truth for how the front face must read. Hand-placing
// the glyphs in canvas 2D is too easy to get subtly wrong (arc direction, letter spacing, glyph
// rotation) — rasterizing the browser's own layout stays correct on every platform.
function ringLabelsSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150" viewBox="0 0 150 150">` +
    `<defs>` +
    `<path id="seal-top-arc" d="M 15 75 A 60 60 0 0 1 135 75"/>` +
    `</defs>` +
    `<text fill="#ffffff" font-family="Times, 'Times New Roman', serif" font-size="12" font-weight="700" letter-spacing="1">` +
    `<textPath href="#seal-top-arc" startOffset="50%" text-anchor="middle">BUILDERS MARKETPLACE</textPath>` +
    `</text>` +
    `</svg>`
  );
}

function loadSvg(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("seal ring-label SVG failed to load"));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// The painted overlay: the ring lettering (rasterized from FlatSeal) plus the hammer, shield and
// compass star drawn in canvas 2D. Everything else stays transparent so the metallic ring meshes
// underneath show through. Drawn in the SVG's 150-unit design space, so coordinates match the mesh
// radii one-to-one. `mirror` flips the drawing for the back face (a coin flipped around its
// vertical axis reads correctly only when its text is pre-mirrored).
async function overlayTexture(edge: number, mirror: boolean): Promise<THREE.CanvasTexture> {
  const c = document.createElement("canvas");
  c.width = c.height = edge;
  const g = c.getContext("2d")!;
  g.scale(edge / 150, edge / 150);
  if (mirror) {
    g.translate(150, 0);
    g.scale(-1, 1);
  }

  // Ring labels first, then the symmetric emblem art over them. Loading is async, so the caller
  // lists this texture in the disposables it creates after the awaits resolve.
  g.drawImage(await loadSvg(ringLabelsSvg()), 0, 0, 150, 150);

  // Hammer head and haft, centred above the shield.
  g.fillStyle = "#3a3a3a";
  g.fillRect(61, 31, 28, 7);
  g.fillStyle = "#8b5a2b";
  g.fillRect(72, 38, 6, 14);

  // Shield: navy fill, gold outline.
  g.beginPath();
  g.moveTo(55, 54);
  g.lineTo(95, 54);
  g.lineTo(95, 78);
  g.quadraticCurveTo(95, 100, 75, 110);
  g.quadraticCurveTo(55, 100, 55, 78);
  g.closePath();
  g.fillStyle = NAVY;
  g.fill();
  g.strokeStyle = GOLD;
  g.lineWidth = 1.5;
  g.stroke();

  // Compass star: red fill, white outline.
  const pts = starPoints(75, 79, 17, 6)
    .split(" ")
    .map((pair) => pair.split(",").map(Number) as [number, number]);
  g.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  g.fillStyle = RED;
  g.fill();
  g.strokeStyle = "#ffffff";
  g.lineWidth = 0.6;
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

async function buildCoin(container: HTMLElement, shouldSpin: () => boolean): Promise<() => void> {
  // Paint the two overlays first: they are the only async work (SVG decode), and nothing three.js
  // has been allocated yet, so a failed decode simply leaves the flat SVG fallback in place.
  // The back face's group carries rotation.y = PI (see addFace) and the camera sees it from +Z, so
  // the mesh ITSELF reverses the drawing once. That single mesh mirror is exactly what a viewer
  // needs to read the lettering normally, so both textures are drawn plain: pre-mirroring the back
  // one added a second reversal and made it read "ЯƎꓭꓷꓵꓭ" (the Commander's rejected verdict).
  const overlayFront = await overlayTexture(512, false);
  const overlayBack = await overlayTexture(512, false);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();

  // Camera sits on the +Z axis. At 28.5 degrees and distance 310 the frustum is 157 units tall,
  // so the 144-unit emblem nearly fills the square viewport and spins toward the viewer around
  // its vertical (Y) axis.
  const camera = new THREE.PerspectiveCamera(28.5, 1, 0.1, 1000);
  camera.position.z = 310;

  // Shared resources; disposed together on unmount. The two faces reuse the same geometry and
  // materials, so the back is a true mirror of the front, not a second copy.
  const disposables: Array<{ dispose(): void }> = [overlayFront, overlayBack];
  const track = <T extends { dispose(): void }>(d: T): T => (disposables.push(d), d);

  // Height 5 (not 6): after rotating flat, the circular caps land at z = ±2.5, just inside the
  // ring meshes at z = ±3, so the navy body and navy ring never share a plane (no z-fighting).
  const bodyGeom = track(new THREE.CylinderGeometry(72, 72, 5, 96));
  const ringGeom = track(new THREE.RingGeometry(52, 72, 96));
  const discGeom = track(new THREE.CircleGeometry(52, 96));
  const bandGeom = track(new THREE.RingGeometry(52, 70, 96, 1, 200 * DEG, 140 * DEG));
  const outlineOuterGeom = track(new THREE.RingGeometry(71, 72.5, 96));
  const outlineInnerGeom = track(new THREE.RingGeometry(51, 52.5, 96));
  const overlayGeom = track(new THREE.PlaneGeometry(150, 150));

  const navyMat = track(new THREE.MeshStandardMaterial({ color: NAVY, metalness: 0.55, roughness: 0.3 }));
  const goldMat = track(new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.95, roughness: 0.18 }));
  const whiteMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.4 }));
  const overlayMatFront = track(
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: overlayFront, transparent: true, metalness: 0.1, roughness: 0.5 }),
  );
  const overlayMatBack = track(
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: overlayBack, transparent: true, metalness: 0.1, roughness: 0.5 }),
  );

  const coin = new THREE.Group();

  // Solid navy body gives the coin a visible edge while it turns. CylinderGeometry's axis is Y,
  // so flat it around X to point the circular face at the camera: face-on it fills the ring's
  // centre, edge-on only its 6-unit rim shows (no more navy bar across the middle).
  const body = new THREE.Mesh(bodyGeom, navyMat);
  body.rotation.x = Math.PI / 2;
  coin.add(body);

  // One face assembly, layered back-to-front: navy ring, white field, gold 140-degree band,
  // thin gold outlines, then the painted lettering/shield overlay on top.
  const addFace = (side: number) => {
    const face = new THREE.Group();
    face.position.z = side * 3;
    if (side < 0) face.rotation.y = Math.PI;
    const add = (geom: THREE.BufferGeometry, mat: THREE.Material, z: number) => {
      const m = new THREE.Mesh(geom, mat);
      m.position.z = z;
      face.add(m);
    };
    add(ringGeom, navyMat, 0);
    add(discGeom, whiteMat, 0.15);
    add(bandGeom, goldMat, 0.3);
    add(outlineOuterGeom, goldMat, 0.45);
    add(outlineInnerGeom, goldMat, 0.45);
    add(overlayGeom, side < 0 ? overlayMatBack : overlayMatFront, 0.6);
    coin.add(face);
  };
  addFace(1);
  addFace(-1);

  // Lights shape the disc; an environment map adds the reflections that make the metal read.
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(120, 180, 240);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.2);
  fill.position.set(-160, 40, 160);
  scene.add(fill);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();

  scene.add(coin);
  container.replaceChildren();
  container.appendChild(renderer.domElement);
  // Seed the rotation attribute so it exists the moment the coin is built: on a static page it
  // stays "0" forever (proof it is not spinning), on a listing it grows frame by frame.
  container.dataset.rotation = String(coin.rotation.y);

  let disposed = false;
  let raf = 0;

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setSize(
      Math.max(1, Math.round(rect.width * dpr)),
      Math.max(1, Math.round(rect.height * dpr)),
      false,
    );
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  };
  resize();

  const animate = () => {
    if (disposed) return;
    // Spin the coin around its local Y axis only while the caller says to (a listing page); on a
    // project page it holds still. The live angle is mirrored to a data attribute so a browser
    // check can prove the coin is turning (monotonically increasing on the index, untouched
    // everywhere else). Whether it is allowed to spin is the Seal component's concern, exposed as
    // `data-spinning` on the container.
    if (shouldSpin()) {
      coin.rotation.y += 0.018;
      container.dataset.rotation = String(coin.rotation.y);
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  animate();

  window.addEventListener("resize", resize);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    renderer.dispose();
    envRT.dispose();
    for (const d of disposables) d.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  };
}

export function Seal() {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Keep the seal alive when a user clicks into a project: animate only while browsing the
  // listing, and hold still on a project page or any other route. `usePathname` returns the
  // pathname without the query string, so `/` also covers `/?page=5`. The layout keeps this
  // component mounted across client navigations, so the coin must read the live answer every
  // frame rather than capture it once; a ref carries it to the buildCoin callback.
  const spinning = pathname === "/";
  const shouldSpinRef = useRef(spinning);
  shouldSpinRef.current = spinning;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Leave the flat SVG in place when WebGL is unavailable; otherwise replace it with the coin.
    const hasWebGL = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(c.getContext("webgl2") || c.getContext("webgl"));
      } catch {
        return false;
      }
    })();
    if (!hasWebGL) return;

    // buildCoin is async only because of the SVG decode; until it resolves the flat SVG stays put.
    // If the effect unmounts first, cancel and dispose whatever landed.
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    buildCoin(el, () => shouldSpinRef.current)
      .then((stop) => {
        if (cancelled) stop();
        else cleanup = stop;
      })
      .catch(() => {
        /* keep the flat SVG fallback */
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={ref}
      className="seal"
      role="img"
      aria-label="Seal of the Builders Marketplace"
      data-spinning={spinning ? "true" : "false"}
    >
      <FlatSeal />
    </div>
  );
}
