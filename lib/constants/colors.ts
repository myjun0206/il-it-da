/**
 * Color Token System
 * 모든 색상은 여기서 정의합니다.
 * CSS 변수와 동기화되어 있습니다.
 */

export const colors = {
  // Primary Colors (Green - 기존 브랜드 컬러)
  primary: {
    main: "#1c6b52",           // 주요 버튼, 헤더 배경
    hover: "#154d3f",          // hover 상태
    light: "#e3eee0",          // light background
    accent: "#0C9D81",         // accent, focus
  },

  // Secondary Colors (Deep Navy - Brown 대체)
  secondary: {
    main: "#1A3A4A",           // 보조 강조색
    hover: "#132d38",          // hover 상태
    light: "#e5f1f5",          // light background
  },

  // Text Colors
  text: {
    primary: "#0d1117",        // 주요 텍스트 (매우 어두운 Navy)
    secondary: "#60736b",      // 보조 텍스트
    tertiary: "#8aa097",       // 약한 텍스트
    inverse: "#ffffff",        // 역색 (흰색)
  },

  // Status Colors
  status: {
    success: "#1c6b52",        // 성공 (Green)
    warning: "#e8a745",        // 경고 (Orange)
    error: "#c53030",          // 오류 (Red)
    info: "#0066cc",           // 정보 (Blue)
  },

  // Neutral Colors
  neutral: {
    white: "#ffffff",
    offWhite: "#f9fafb",
    lightGray: "#f3f4f6",
    gray: "#e5e7eb",
    darkGray: "#6b7280",
    black: "#111827",
  },

  // Specific UI Colors
  background: {
    default: "#f7f9f5",        // 기본 배경
    surface: "#ffffff",        // 카드, 입력창 배경
    lightMint: "#f0f9f6",      // 밝은 민트
  },

  border: {
    default: "#dfe7dc",        // 기본 테두리
    light: "#e9ede8",          // 밝은 테두리
  },
} as const;

/**
 * CSS 변수로도 정의 (globals.css에서 사용)
 * 아래는 참고용입니다.
 */
export const cssVariables = {
  "--color-primary": colors.primary.main,
  "--color-primary-hover": colors.primary.hover,
  "--color-primary-light": colors.primary.light,
  "--color-primary-accent": colors.primary.accent,
  "--color-secondary": colors.secondary.main,
  "--color-secondary-hover": colors.secondary.hover,
  "--color-secondary-light": colors.secondary.light,
  "--color-text-primary": colors.text.primary,
  "--color-text-secondary": colors.text.secondary,
  "--color-text-tertiary": colors.text.tertiary,
  "--color-status-success": colors.status.success,
  "--color-status-warning": colors.status.warning,
  "--color-status-error": colors.status.error,
  "--color-status-info": colors.status.info,
  "--color-bg-default": colors.background.default,
  "--color-bg-surface": colors.background.surface,
  "--color-bg-light-mint": colors.background.lightMint,
  "--color-border": colors.border.default,
  "--color-border-light": colors.border.light,
} as const;
