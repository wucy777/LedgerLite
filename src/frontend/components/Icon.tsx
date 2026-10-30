import type { ReactNode, SVGProps } from 'react';
import type { IconName } from '@shared/types';

export type UIIconName =
  | 'plus'
  | 'ledger'
  | 'chart'
  | 'settings'
  | 'search'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'arrow-up-right'
  | 'arrow-down-left'
  | 'backspace'
  | 'calendar'
  | 'note'
  | 'check'
  | 'trash'
  | 'lock'
  | 'unlock'
  | 'shield'
  | 'download'
  | 'upload'
  | 'info'
  | 'refresh'
  | 'eye'
  | 'eye-off'
  | 'alert'
  | 'wallet'
  | 'edit'
  | 'archive'
  | 'sparkle';

export type AnyIconName = UIIconName | IconName;

const GLYPHS: Record<AnyIconName, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  ledger: (
    <>
      <path d="M6.5 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19.5V13M10 19.5V7M16 19.5v-9M22 19.5H2" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8M16.5 7H20M4 17h2M10.5 17H20" />
      <circle cx="14" cy="7" r="2.2" />
      <circle cx="8" cy="17" r="2.2" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m15.4 15.4 4.1 4.1" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  'chevron-left': <path d="m14.5 5-7 7 7 7" />,
  'chevron-right': <path d="m9.5 5 7 7-7 7" />,
  'chevron-down': <path d="m5 9.5 7 7 7-7" />,
  'arrow-up-right': <path d="M7 17 17 7M8 7h9v9" />,
  'arrow-down-left': <path d="M17 7 7 17M16 17H7V8" />,
  backspace: (
    <>
      <path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7 6-7Z" />
      <path d="m12 9 5 6M17 9l-5 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M7.5 3v4M16.5 3v4M3.5 10h17" />
      <path d="M8 14h1M12 14h1M16 14h1M8 17.5h1M12 17.5h1" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h14v15H5z" />
      <path d="M8.5 9h7M8.5 13h5" />
    </>
  ),
  check: <path d="m5 12.5 4.2 4.2L19 6.8" />,
  trash: (
    <>
      <path d="M4 7h16M9 3.8h6M6.5 7l.8 13h9.4l.8-13M10 11v5M14 11v5" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10M12 14v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="2.5" />
      <path d="M8 10V7.5a4 4 0 0 1 7.5-2M12 14v3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.4c0 4.4 2.9 7.7 7 9.6 4.1-1.9 7-5.2 7-9.6V6l-7-3Z" />
      <path d="m9 12 2.1 2.1L15.5 9.7" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4 20h16" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M7.5 8.5 12 4l4.5 4.5M4 20h16" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 10.8V17M12 7.3v.2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5M4 17v-5h5" />
      <path d="M6.1 8a7 7 0 0 1 11.5-1.4L20 9M4 15l2.4 2.4A7 7 0 0 0 18 16" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z" />
      <circle cx="12" cy="12" r="2.7" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4 20 20M9.8 6.3A9.8 9.8 0 0 1 12 6c5.8 0 9.2 6 9.2 6a17 17 0 0 1-2.6 3.2M6.2 7.4A16 16 0 0 0 2.8 12s3.4 6 9.2 6c1.2 0 2.3-.3 3.3-.7" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.8 19.2h18.4L12 3Z" />
      <path d="M12 9v4.5M12 16.6v.2" />
    </>
  ),
  wallet: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5Z" />
      <path d="M4 7h13.5A2.5 2.5 0 0 1 20 9.5V13h-4.5a2.2 2.2 0 1 0 0 4.4H20" />
    </>
  ),
  edit: (
    <>
      <path d="m14.5 5.5 4 4M5 19h4l9.8-9.8a2.8 2.8 0 0 0-4-4L5 15v4Z" />
    </>
  ),
  archive: (
    <>
      <path d="M4 7h16v13H4V7ZM3 3.5h18V7H3V3.5Z" />
      <path d="M9 11h6" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3c.5 4.8 3.2 7.5 8 8-4.8.5-7.5 3.2-8 8-.5-4.8-3.2-7.5-8-8 4.8-.5 7.5-3.2 8-8Z" />
      <path d="M19.5 16.5c.2 1.7 1.3 2.8 3 3-1.7.2-2.8 1.3-3 3-.2-1.7-1.3-2.8-3-3 1.7-.2 2.8-1.3 3-3Z" />
    </>
  ),

  food: (
    <>
      <path d="M4 11h16c0 4.4-3.6 8-8 8s-8-3.6-8-8Z" />
      <path d="M8 8.2c0-1.4.9-1.9.9-3M12 8.2c0-1.4.9-1.9.9-3M16 8.2c0-1.4.9-1.9.9-3M8 21h8" />
    </>
  ),
  transport: (
    <>
      <rect x="4" y="3.5" width="16" height="14" rx="3" />
      <path d="M4 10h16M7.5 14h1M15.5 14h1M7.5 17.5V21M16.5 17.5V21" />
    </>
  ),
  shopping: (
    <>
      <path d="M5 8h14l-1 12H6L5 8Z" />
      <path d="M8.5 9V6.5a3.5 3.5 0 0 1 7 0V9" />
    </>
  ),
  home: (
    <>
      <path d="m3.5 11 8.5-7.5 8.5 7.5" />
      <path d="M5.5 10v10h13V10M9.5 20v-6h5v6" />
    </>
  ),
  fun: (
    <>
      <path d="M7.5 7.5h9a5 5 0 0 1 4.7 6.7l-.5 1.5a2.8 2.8 0 0 1-5 0l-.8-1.2H9.1l-.8 1.2a2.8 2.8 0 0 1-5 0l-.5-1.5A5 5 0 0 1 7.5 7.5Z" />
      <path d="M8 10v4M6 12h4M15.5 11h.1M18 13.5h.1" />
    </>
  ),
  health: (
    <>
      <path d="M12 20s-8-4.6-8-10.4A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 8 3.6C20 15.4 12 20 12 20Z" />
      <path d="M4.8 12h4l1.5-3 3 6 1.7-3h4.2" />
    </>
  ),
  education: (
    <>
      <path d="M3.5 5.5c3.2-.8 5.9.4 8.5 2 2.6-1.6 5.3-2.8 8.5-2v13c-3.2-.8-5.9.4-8.5 2-2.6-1.6-5.3-2.8-8.5-2v-13Z" />
      <path d="M12 7.5v13" />
    </>
  ),
  other: (
    <>
      <path d="M12 3.5c.4 3.7 2.5 5.8 6.2 6.2-3.7.4-5.8 2.5-6.2 6.2-.4-3.7-2.5-5.8-6.2-6.2 3.7-.4 5.8-2.5 6.2-6.2Z" />
      <path d="M18 15.5c.2 1.8 1.2 2.8 3 3-1.8.2-2.8 1.2-3 3-.2-1.8-1.2-2.8-3-3 1.8-.2 2.8-1.2 3-3Z" />
    </>
  ),
  salary: (
    <>
      <rect x="3.5" y="7" width="17" height="12.5" rx="2.5" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17M12 11v3" />
    </>
  ),
  bonus: (
    <>
      <circle cx="12" cy="9" r="5.2" />
      <path d="m8.6 13.2-1.3 7L12 17.8l4.7 2.4-1.3-7M12 6.7l.8 1.6 1.8.2-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.2.8-1.6Z" />
    </>
  ),
  invest: (
    <>
      <path d="M4 19V5M4 19h16" />
      <path d="m7 15 3.5-4 3 2 5-6M16.5 7H19v2.5" />
    </>
  ),
  parttime: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.3l3.5 2" />
    </>
  ),
  gift: (
    <>
      <path d="M3.5 10h17v10h-17V10ZM2.5 6.5h19V10h-19V6.5Z" />
      <path d="M12 6.5V20M12 6.5H8.2a2.2 2.2 0 1 1 2.2-2.2c0 1.3 1.6 2.2 1.6 2.2ZM12 6.5h3.8a2.2 2.2 0 1 0-2.2-2.2c0 1.3-1.6 2.2-1.6 2.2Z" />
    </>
  ),
  refund: (
    <>
      <path d="M4 8h12a4.5 4.5 0 0 1 0 9H8" />
      <path d="M8 4 4 8l4 4" />
    </>
  ),
  wechat: (
    <>
      <path d="M14.2 16.7a6.7 6.7 0 0 0 2.2-9.8A7.3 7.3 0 0 0 3.5 10c0 2 1 3.7 2.6 4.9l-.7 3 3.1-1.4a8.5 8.5 0 0 0 5.7 0Z" />
      <path d="M13 10.7a5.5 5.5 0 0 1 7.3 5.2c0 1.5-.8 2.8-2 3.7l.5 2.3-2.4-1.1a6.7 6.7 0 0 1-4.3-.1" />
      <path d="M7.2 8.6h.1M10.8 8.6h.1" />
    </>
  ),
  alipay: (
    <>
      <path d="M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6Z" />
      <path d="M14 14h2v2h2v2h-2v2h-2v-2h-2v-2h2v-2Z" />
    </>
  ),
  bank: (
    <>
      <path d="m3 9 9-5 9 5H3ZM5 9v9M9.7 9v9M14.3 9v9M19 9v9M3 18h18M2.5 21h19" />
    </>
  ),
  cash: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M7 9.5h.1M17 14.5h.1" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M6.5 15h3" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: AnyIconName;
  size?: number;
  label?: string;
}

export function Icon({ name, size = 20, label, strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      focusable="false"
      {...props}
    >
      {label ? <title>{label}</title> : null}
      {GLYPHS[name]}
    </svg>
  );
}

export function isKnownIcon(name: string): name is AnyIconName {
  return name in GLYPHS;
}
