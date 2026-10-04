/** The IA Connect mark (same drawing as the favicon). Decorative: the name is always next to it. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative, the name is next to it
    <svg viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <rect width="32" height="32" rx="9" fill="#06724F" />
      <path
        d="M13.5 13.6C17 11.6 17.4 9.5 20 9.5M13.5 18.4C17 20.4 17.4 22.5 20 22.5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="10.5" cy="16" r="4.4" fill="#fff" />
      <circle cx="22.6" cy="9.5" r="3" fill="#fff" />
      <circle cx="22.6" cy="22.5" r="3" fill="#F6C25B" />
    </svg>
  );
}
