/**
 * Spacing Token System
 * 공통 spacing 값들을 정의합니다.
 * Tailwind 기본값을 따르면서 커스텀 추가
 */

export const spacing = {
  // 기본 spacing scale
  xs: "4px",      // 0.25rem
  sm: "8px",      // 0.5rem
  md: "12px",     // 0.75rem
  lg: "16px",     // 1rem
  xl: "24px",     // 1.5rem
  "2xl": "32px",  // 2rem
  "3xl": "48px",  // 3rem
  "4xl": "64px",  // 4rem

  // Page spacing
  pageGutter: {
    mobile: "16px",
    tablet: "24px",
    desktop: "32px",
  },

  // Container
  container: {
    mobile: "100%",
    tablet: "768px",
    desktop: "1440px",
  },

  // Component spacing
  button: {
    padding: {
      small: "8px 16px",
      medium: "12px 24px",
      large: "16px 32px",
    },
    height: {
      small: "32px",
      medium: "40px",
      large: "48px",
    },
  },

  card: {
    padding: {
      small: "12px",
      medium: "16px",
      large: "24px",
    },
  },

  input: {
    padding: "12px 16px",
    height: "40px",
  },

  // Gap values
  gap: {
    xs: "4px",
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "24px",
    "2xl": "32px",
  },

  // Border radius
  radius: {
    sm: "8px",
    md: "12px",
    lg: "16px",
    xl: "20px",
    full: "9999px",
  },
} as const;

/**
 * 반응형 breakpoints
 */
export const breakpoints = {
  mobile: "0px",
  sm: "640px",
  tablet: "768px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const;

/**
 * z-index scale
 */
export const zIndex = {
  hide: -1,
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  fixed: 1200,
  modal: 1300,
  popover: 1400,
  tooltip: 1500,
} as const;

/**
 * Shadow values
 */
export const shadows = {
  none: "none",
  sm: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
  base: "0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
} as const;

/**
 * Transition timing
 */
export const transitions = {
  fast: "150ms ease",
  base: "200ms ease",
  slow: "300ms ease",
} as const;
