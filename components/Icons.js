// ─── Icon set ──────────────────────────────────────────────────────────────
// Inline SVG replacements for emoji, kept stroke-based & minimal so they
// inherit `currentColor` and sit flush with the rest of the UI at any size.

const base = (size, children, viewBox = '0 0 24 24') => (
  <svg
    width={size}
    height={size}
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
)

export function IconRadar({ size = 16 }) {
  return base(size, (
    <>
      <circle cx="12" cy="12" r="9" opacity="0.35" />
      <circle cx="12" cy="12" r="5.5" opacity="0.6" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <path d="M12 12 L18 7" />
    </>
  ))
}

export function IconSpark({ size = 14 }) {
  return base(size, (
    <path d="M12 3 L13.6 9.2 L20 11 L13.6 12.8 L12 19 L10.4 12.8 L4 11 L10.4 9.2 Z" />
  ))
}

export function IconUpload({ size = 14 }) {
  return base(size, (
    <>
      <path d="M12 16 V4" />
      <path d="M7 8 L12 3 L17 8" />
      <path d="M4 16 V19 A2 2 0 0 0 6 21 H18 A2 2 0 0 0 20 19 V16" />
    </>
  ))
}

export function IconClipboard({ size = 15 }) {
  return base(size, (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4 V3 A1 1 0 0 1 10 2 H14 A1 1 0 0 1 15 3 V4" />
      <path d="M9 10 H15" />
      <path d="M9 14 H15" />
      <path d="M9 18 H12.5" />
    </>
  ))
}

export function IconLink({ size = 13 }) {
  return base(size, (
    <>
      <path d="M9.5 14.5 L14.5 9.5" />
      <path d="M11 7 L13.2 4.8 A3.5 3.5 0 0 1 18.2 9.8 L16 12" />
      <path d="M13 17 L10.8 19.2 A3.5 3.5 0 0 1 5.8 14.2 L8 12" />
    </>
  ))
}

export function IconCheck({ size = 13 }) {
  return base(size, <path d="M4 12.5 L9.5 18 L20 6" />)
}

export function IconClose({ size = 13 }) {
  return base(size, (
    <>
      <path d="M5 5 L19 19" />
      <path d="M19 5 L5 19" />
    </>
  ))
}

export function IconWarning({ size = 14 }) {
  return base(size, (
    <>
      <path d="M12 3 L21.5 20 H2.5 Z" />
      <path d="M12 9.5 V14" />
      <circle cx="12" cy="17.2" r="0.15" fill="currentColor" />
    </>
  ))
}

export function IconEye({ size = 13 }) {
  return base(size, (
    <>
      <path d="M2 12 C5 6.5 9 4 12 4 C15 4 19 6.5 22 12 C19 17.5 15 20 12 20 C9 20 5 17.5 2 12 Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ))
}

export function IconTrash({ size = 13 }) {
  return base(size, (
    <>
      <path d="M4 7 H20" />
      <path d="M9 7 V4.5 A1 1 0 0 1 10 3.5 H14 A1 1 0 0 1 15 4.5 V7" />
      <path d="M6.5 7 L7.3 19.5 A2 2 0 0 0 9.3 21.3 H14.7 A2 2 0 0 0 16.7 19.5 L17.5 7" />
      <path d="M10 11 V17" />
      <path d="M14 11 V17" />
    </>
  ))
}

export function IconFolder({ size = 30 }) {
  return base(size, (
    <path d="M3 6.5 A1.5 1.5 0 0 1 4.5 5 H9.5 L11.5 7.5 H19.5 A1.5 1.5 0 0 1 21 9 V17.5 A1.5 1.5 0 0 1 19.5 19 H4.5 A1.5 1.5 0 0 1 3 17.5 Z" />
  ))
}

export function IconInbox({ size = 30 }) {
  return base(size, (
    <>
      <path d="M3 12 H8 L10 15 H14 L16 12 H21" />
      <path d="M5.5 5 H18.5 L21 12 V18 A1.5 1.5 0 0 1 19.5 19.5 H4.5 A1.5 1.5 0 0 1 3 18 V12 Z" />
    </>
  ))
}

export function IconLaptop({ size = 14 }) {
  return base(size, (
    <>
      <rect x="4" y="4.5" width="16" height="10.5" rx="1.2" />
      <path d="M2 19.5 H22 L20.2 16.5 H3.8 Z" />
    </>
  ))
}

export function IconPhone({ size = 14 }) {
  return base(size, (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.2 H13" />
    </>
  ))
}

export function IconDesktop({ size = 14 }) {
  return base(size, (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.2" />
      <path d="M9 20 H15" />
      <path d="M12 16 V20" />
    </>
  ))
}

export function IconDot({ size = 8, color }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
      <circle cx="4" cy="4" r="4" fill={color || 'currentColor'} />
    </svg>
  )
}

// ─── File-type icons ─────────────────────────────────────────────────────────

export function IconImageFile({ size = 20 }) {
  return base(size, (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M3 16.5 L8.5 11.5 L13 15.5 L16.5 12.5 L21 17" />
    </>
  ))
}

export function IconVideoFile({ size = 20 }) {
  return base(size, (
    <>
      <rect x="3" y="5.5" width="13" height="13" rx="1.5" />
      <path d="M16 10 L21 7.5 V16.5 L16 14 Z" />
    </>
  ))
}

export function IconAudioFile({ size = 20 }) {
  return base(size, (
    <>
      <path d="M9 17.5 V6 L19 4 V15.5" />
      <circle cx="7" cy="17.5" r="2.2" />
      <circle cx="17" cy="15.5" r="2.2" />
    </>
  ))
}

export function IconPdfFile({ size = 20 }) {
  return base(size, (
    <>
      <path d="M6 3 H14 L18 7 V21 H6 Z" />
      <path d="M14 3 V7 H18" />
      <path d="M8.5 12 H10 A1.3 1.3 0 0 1 10 14.6 H8.5 Z M8.5 12 V17" />
      <path d="M12.5 17 V12 H14 A1.3 1.3 0 0 1 14 14.5 H12.5" />
      <path d="M16 12 V17 M16 14.3 H17.4" />
    </>
  ))
}

export function IconArchiveFile({ size = 20 }) {
  return base(size, (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M12 4 V20" strokeDasharray="1.6 1.6" />
      <rect x="10.3" y="8.5" width="3.4" height="3" />
    </>
  ))
}

export function IconWordFile({ size = 20 }) {
  return base(size, (
    <>
      <path d="M6 3 H14 L18 7 V21 H6 Z" />
      <path d="M14 3 V7 H18" />
      <path d="M8 12 L9.3 17 L10.6 13 L11.9 17 L13.2 12" />
    </>
  ))
}

export function IconSheetFile({ size = 20 }) {
  return base(size, (
    <>
      <path d="M6 3 H14 L18 7 V21 H6 Z" />
      <path d="M14 3 V7 H18" />
      <path d="M8.5 11.5 H15.5 V17.5 H8.5 Z" />
      <path d="M8.5 14.5 H15.5" />
      <path d="M11.7 11.5 V17.5" />
    </>
  ))
}

export function IconSlidesFile({ size = 20 }) {
  return base(size, (
    <>
      <path d="M6 3 H14 L18 7 V21 H6 Z" />
      <path d="M14 3 V7 H18" />
      <rect x="8.3" y="11.5" width="7.4" height="5" />
      <path d="M10 19 H14" />
    </>
  ))
}

export function IconCodeFile({ size = 20 }) {
  return base(size, (
    <>
      <path d="M6 3 H14 L18 7 V21 H6 Z" />
      <path d="M14 3 V7 H18" />
      <path d="M9.5 12 L7.5 14.3 L9.5 16.6" />
      <path d="M14.5 12 L16.5 14.3 L14.5 16.6" />
    </>
  ))
}

export function IconApkFile({ size = 20 }) {
  return base(size, (
    <>
      <rect x="6" y="8" width="12" height="12" rx="2" />
      <path d="M9 8 V5.5 A1 1 0 0 1 10 4.5 H14 A1 1 0 0 1 15 5.5 V8" />
      <path d="M9.5 12.5 V15.5" />
      <path d="M14.5 12.5 V15.5" />
    </>
  ))
}

export function IconGenericFile({ size = 20 }) {
  return base(size, (
    <>
      <path d="M6 3 H14 L18 7 V21 H6 Z" />
      <path d="M14 3 V7 H18" />
    </>
  ))
}

const FILE_ICON_MAP = {
  image: IconImageFile,
  video: IconVideoFile,
  audio: IconAudioFile,
  pdf: IconPdfFile,
  archive: IconArchiveFile,
  word: IconWordFile,
  sheet: IconSheetFile,
  slides: IconSlidesFile,
  code: IconCodeFile,
  apk: IconApkFile,
  generic: IconGenericFile,
}

export function FileIcon({ type, size = 20 }) {
  const Cmp = FILE_ICON_MAP[type] || IconGenericFile
  return <Cmp size={size} />
}
