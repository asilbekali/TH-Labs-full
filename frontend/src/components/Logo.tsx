/**
 * The TH-LABS wordmark — always the pixel font (Press Start 2P). Never
 * hardcode the wordmark anywhere else.
 *
 * Mirrors components/wordmark.tsx on the landing page, minus the
 * per-character reveal animation, which only the landing hero uses. Keeping
 * the two in sync is what makes crossing from the landing page into the
 * Studio read as one product rather than two.
 *
 * This replaces the previous mark — a violet→fuchsia→cyan equaliser glyph
 * beside "TH·Labs" set in Inter — which belonged to the older brand.
 */
export default function Logo({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-pixel select-none uppercase leading-none tracking-[0.08em] text-white ${className}`}
    >
      TH-LABS
    </span>
  )
}
