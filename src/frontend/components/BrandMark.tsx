import { useId } from 'react';

interface BrandMarkProps {
  size?: number;
  className?: string;
  decorative?: boolean;
}

export function BrandMark({ size = 40, className, decorative = true }: BrandMarkProps) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      aria-hidden={decorative ? true : undefined}
      role={decorative ? undefined : 'img'}
      focusable="false"
    >
      {!decorative ? <title>简账</title> : null}
      <defs>
        <linearGradient id={gradientId} x1="8" y1="4" x2="41" y2="45" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2e513b" />
          <stop offset="1" stopColor="#18271e" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradientId})`} />
      <path d="M14 16.5h20M14 23.5h12" stroke="#f4efe3" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M14 31h8" stroke="#f4efe3" strokeWidth="2.8" strokeLinecap="round" opacity=".55" />
      <circle cx="31.5" cy="31" r="4.2" fill="#e58a6c" />
    </svg>
  );
}
