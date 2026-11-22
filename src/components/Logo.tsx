/**
 * The Allot wordmark drawn as a CSS mask filled with the theme's brand colour,
 * so it follows the in-app light/dark choice (an <img> SVG can only follow the OS).
 */
export function Logo({ className = "h-8", label = "Allot" }: { className?: string; label?: string }) {
  const mask = "url(/allot-logo.svg)";
  return (
    <span
      role="img"
      aria-label={label}
      className={`inline-block aspect-[1456/414] bg-brand-ink ${className}`}
      style={{
        maskImage: mask,
        WebkitMaskImage: mask,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
      }}
    />
  );
}
