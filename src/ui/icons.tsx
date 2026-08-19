import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 14, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  }
}

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
)

export const CursorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 2.5l8 5.2-3.6.9-.9 3.9L4 2.5z" />
  </svg>
)

export const PenIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2.8c-2.4 2-3.8 4-3.8 6a3.8 3.8 0 007.6 0c0-2-1.4-4-3.8-6z" />
    <circle cx="8" cy="9" r="1.1" />
    <path d="M8 10.1v3.4" />
  </svg>
)

export const ImportIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2.5v7M5.2 7l2.8 2.8L10.8 7" />
    <path d="M3 11v1.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V11" />
  </svg>
)

export const ExportIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 9.5V2.5M5.2 5.3L8 2.5l2.8 2.8" />
    <path d="M3 11v1.5A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5V11" />
  </svg>
)

export const SettingsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 2.4v1.5M8 12.1v1.5M2.4 8h1.5M12.1 8h1.5M4.1 4.1l1.1 1.1M10.8 10.8l1.1 1.1M11.9 4.1l-1.1 1.1M5.2 10.8l-1.1 1.1" />
  </svg>
)

export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5.5 3.5l7 4.5-7 4.5v-9z" />
  </svg>
)

export const CubeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 1.8l5.4 3.1v6.2L8 14.2l-5.4-3.1V4.9L8 1.8z" />
    <path d="M2.6 4.9L8 8m0 0l5.4-3.1M8 8v6.2" />
  </svg>
)

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
  </svg>
)

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3.5 3.5" />
  </svg>
)

export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 4.5h10M3 8h10M3 11.5h10" />
  </svg>
)

export const BookIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 3.2A1.2 1.2 0 014.2 2H13v11H4.2A1.2 1.2 0 003 14.2V3.2z" />
    <path d="M3 12.5A1.5 1.5 0 014.5 11H13" />
  </svg>
)

export const TrashIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
    <path d="M3 5h10M6.5 5V3.5h3V5M4.5 5l.5 8h6l.5-8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const CameraIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="4.5" width="8.5" height="7" rx="1.5" />
    <path d="M10.5 7.5l3.5-2v5l-3.5-2" />
  </svg>
)

export const TargetIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="5.2" />
    <circle cx="8" cy="8" r="1.6" />
    <path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2" />
  </svg>
)

export const HelpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="6" />
    <path d="M6.2 6.2A1.9 1.9 0 018 4.8c1 0 1.9.7 1.9 1.7 0 1.2-1.9 1.4-1.9 2.6" />
    <circle cx="8" cy="11.4" r="0.4" fill="currentColor" />
  </svg>
)

export const WandIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 13L10.5 5.5" />
    <path d="M11.2 4.8l1 1-1.6 1.6-1-1z" />
    <path d="M12.2 2.4v1.4M14.4 4.6h1.4M13.5 3.1l1 1M13.5 6.1l1-1" />
  </svg>
)

export const ClapperIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M2.5 6.5h11v7H2.5z" />
    <path d="M2.5 6.5l11-3.2 1.2 4.2-11 3.2z" />
    <path d="M4.2 4.8l1.6 1.1M7 4.1l1.6 1.1M9.8 3.4l1.6 1.1" />
  </svg>
)

export const FrameIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3.5" width="10" height="9" rx="1.2" />
    <path d="M5.5 6.5h5v4h-5z" />
  </svg>
)

export const ListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 4.5h10M3 8h10M3 11.5h10" />
    <circle cx="3" cy="4.5" r="0.6" fill="currentColor" />
    <circle cx="3" cy="8" r="0.6" fill="currentColor" />
    <circle cx="3" cy="11.5" r="0.6" fill="currentColor" />
  </svg>
)

export const SlidersIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5h10M3 11h10" />
    <circle cx="6" cy="5" r="1.4" />
    <circle cx="11" cy="11" r="1.4" />
  </svg>
)

export const MoveIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M8 2.5v11M2.5 8h11" />
    <path d="M5.5 4.5L8 2.5l2.5 2M5.5 11.5L8 13.5l2.5-2M4.5 5.5L2.5 8l2 2.5M11.5 5.5L13.5 8l-2 2.5" />
  </svg>
)

export const DotsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="8" cy="3.5" r="1.1" fill="currentColor" />
    <circle cx="8" cy="8" r="1.1" fill="currentColor" />
    <circle cx="8" cy="12.5" r="1.1" fill="currentColor" />
  </svg>
)

export const MagnetIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 2.8v5.2a4 4 0 008 0V2.8" />
    <path d="M4 2.8h2.6M9.4 2.8H12" />
    <path d="M4 6.6h2.6M9.4 6.6H12" />
  </svg>
)

export const LinkIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6.2 9.8l3.6-3.6" />
    <path d="M7.2 4.2l1-1a2.4 2.4 0 013.4 3.4l-1 1" />
    <path d="M8.8 11.8l-1 1a2.4 2.4 0 01-3.4-3.4l1-1" />
  </svg>
)

export const PathNodesIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="4" cy="8" r="1.6" />
    <circle cx="12" cy="5" r="1.6" />
    <circle cx="12" cy="11" r="1.6" />
    <path d="M5.5 7.4L10.5 5.6M5.5 8.6L10.5 10.4" />
  </svg>
)

export const ImageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2.5" y="3.5" width="11" height="9" rx="1.4" />
    <path d="M2.8 11.2l3.1-3.1 2.2 2.2 2.2-2.8 3.2 3.7" />
    <circle cx="6.2" cy="6.3" r="0.9" />
  </svg>
)

export const ExpandIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9.5 3.5H12.5V6.5" />
    <path d="M6.5 12.5H3.5V9.5" />
    <path d="M12.5 3.5L9 7" />
    <path d="M3.5 12.5L7 9" />
  </svg>
)
