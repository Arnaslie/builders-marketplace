// The site seal, drawn after the 1994 CIA server page: a navy ring with white lettering over the
// top, a gold lower band with red lettering, a white field, and a shield with a red compass star.
// It is an original emblem for DIY Wikipedia, not a copy of any government seal.
// Pure SVG, no external assets. `mark` is the small text-free version used inside the index banners.

const NAVY = "#1b2a5c";
const GOLD = "#d4a017";
const RED = "#c8102e";

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

export function Seal() {
  return (
    <svg
      className="seal"
      viewBox="0 0 150 150"
      role="img"
      aria-label="Seal of the DIY Wikipedia Builders Marketplace"
    >
      {/* The reference seal sits on its own light-grey square, visibly off-white. */}
      <rect width="150" height="150" fill="#f0f0f0" />
      <defs>
        {/* Top arc, left to right over the top; glyphs grow outward from radius 60. */}
        <path id="seal-top-arc" d="M 15 75 A 60 60 0 0 1 135 75" />
        {/* Bottom arc, left to right under the bottom (20 degrees either side); glyphs grow inward. */}
        <path id="seal-bottom-arc" d="M 12.04 97.92 A 67 67 0 0 0 137.96 97.92" />
      </defs>

      <circle cx="75" cy="75" r="72" fill={NAVY} />
      {/* Gold lower band: a thick arc spanning 140 degrees across the bottom of the ring. */}
      <path d="M 17.68 95.86 A 61 61 0 0 0 132.32 95.86" fill="none" stroke={GOLD} strokeWidth="18" />
      <circle cx="75" cy="75" r="72" fill="none" stroke={GOLD} strokeWidth="1.5" />
      <circle cx="75" cy="75" r="52" fill="#ffffff" stroke={GOLD} strokeWidth="1.5" />

      <text fill="#ffffff" fontFamily="Times, 'Times New Roman', serif" fontSize="12" fontWeight="700" letterSpacing="2">
        <textPath href="#seal-top-arc" startOffset="50%" textAnchor="middle">
          DIY WIKIPEDIA
        </textPath>
      </text>
      <text fill={RED} fontFamily="Times, 'Times New Roman', serif" fontSize="8.5" fontWeight="700" letterSpacing="1">
        <textPath href="#seal-bottom-arc" startOffset="50%" textAnchor="middle">
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
