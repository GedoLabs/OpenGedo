// Inline SVG icons used across the redesigned screens.
// Matched 1:1 with shell.jsx in the design bundle (1.6px stroke).

import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function makeIcon(paths: ReactElement, sw = 1.6) {
  const Icon = ({ size = 16, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {paths}
    </svg>
  );
  return Icon;
}

export const IconChat = makeIcon(
  <path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12Z" />
);
export const IconMemory = makeIcon(
  <>
    <path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-3 3v2a3 3 0 0 0 1.5 2.6A3 3 0 0 0 6 19a3 3 0 0 0 3 2 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3Z" />
    <path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 3 3v2a3 3 0 0 1-1.5 2.6A3 3 0 0 1 18 19a3 3 0 0 1-3 2 3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z" />
  </>
);
export const IconExec = makeIcon(<path d="m4 12 5 5L20 6" />);
export const IconInsight = makeIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>
);
export const IconSearch = IconInsight;
export const IconCog = makeIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.3l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </>
);
export const IconSend = makeIcon(
  <>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </>
);
export const IconMic = makeIcon(
  <>
    <rect x="9" y="2" width="6" height="13" rx="3" />
    <path d="M19 10a7 7 0 0 1-14 0" />
    <path d="M12 19v3" />
  </>
);
export const IconPlus = makeIcon(<path d="M12 5v14M5 12h14" />);
export const IconCheck = makeIcon(<path d="m5 12 5 5L20 7" />);
export const IconClock = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>
);
export const IconSpark = makeIcon(
  <>
    <path d="M12 3v3m0 12v3M5 12H2m20 0h-3M5.6 5.6 7.7 7.7m8.6 8.6 2.1 2.1M5.6 18.4 7.7 16.3m8.6-8.6 2.1-2.1" />
    <circle cx="12" cy="12" r="3" />
  </>
);
export const IconBolt = makeIcon(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />);
export const IconTarget = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </>
);
export const IconLeaf = makeIcon(
  <>
    <path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 9-10 1 6-1 12-2 13a7 7 0 0 1 0 4Z" />
    <path d="M2 22c4-2 6-4 9-9" />
  </>
);
export const IconChev = makeIcon(<path d="m9 6 6 6-6 6" />);
export const IconChevD = makeIcon(<path d="m6 9 6 6 6-6" />);
export const IconLayers = makeIcon(
  <>
    <path d="m12 2 10 5-10 5L2 7l10-5Z" />
    <path d="m2 12 10 5 10-5" />
    <path d="m2 17 10 5 10-5" />
  </>
);
export const IconList = makeIcon(
  <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
);
export const IconCal = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>
);
export const IconArrow = makeIcon(<path d="M5 12h14M13 5l7 7-7 7" />);
export const IconArrowD = makeIcon(<path d="M12 5v14M5 13l7 7 7-7" />);
export const IconFlag = makeIcon(<path d="M4 22V4M4 4h11l-2 4 2 4H4" />);
export const IconPin = makeIcon(<path d="M12 17v5M5 12V7a7 7 0 0 1 14 0v5l2 3H3l2-3Z" />);
export const IconWand = makeIcon(
  <>
    <path d="m15 4 2-2 2 2-2 2-2-2Zm-1 5 2 2-11 11-2-2L14 9Z" />
    <path d="M20 9h.01M20 14h.01M16 20h.01" />
  </>
);
export const IconWave = makeIcon(
  <path d="M2 12c2 0 2-3 4-3s2 6 4 6 2-9 4-9 2 6 4 6 2-3 4-3" />
);
export const IconBell = makeIcon(
  <>
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10 21a2 2 0 0 0 4 0" />
  </>
);
// 待确认（记忆确认队列）：勾选清单造型，刻意区别于分身收件箱的信件/托盘语义
export const IconListChecks = makeIcon(
  <>
    <path d="m3 7 2 2 4-4" />
    <path d="m3 17 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </>
);
export const IconSun = makeIcon(
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.5-7.5-1.4 1.4M7.9 16.1l-1.4 1.4m11 0-1.4-1.4M7.9 7.9 6.5 6.5" />
  </>
);
export const IconMoon = makeIcon(
  <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
);
export const IconPalette = makeIcon(
  <>
    <path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 5-5 5h-2a2 2 0 0 0-2 2 4 4 0 0 1-1 3" />
    <circle cx="6.5" cy="13" r="1.2" fill="currentColor" />
    <circle cx="9" cy="8" r="1.2" fill="currentColor" />
    <circle cx="14" cy="7" r="1.2" fill="currentColor" />
    <circle cx="17.5" cy="11" r="1.2" fill="currentColor" />
  </>
);

// Monitor/screen icon — used for "Auto / system" theme
export const IconMonitor = makeIcon(
  <>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </>
);

// Message actions — edit / delete (recall) / stop generating.
export const IconEdit = makeIcon(
  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" />
);
export const IconTrash = makeIcon(
  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
);
export const IconStop = makeIcon(
  <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
);
