/**
 * Brand Logo Mapping
 * Maps brand names to their logo paths
 * Logo files should be placed in public/brands/logos/
 */

export const brandLogoMap: Record<string, string> = {
  // 메가MGC커피
  메가MGC커피: "/brands/logos/mega-mgc.png",
  "메가MGC": "/brands/logos/mega-mgc.png",
  
  // 컴포즈커피
  컴포즈커피: "/brands/logos/compose.png",
  "컴포즈": "/brands/logos/compose.png",
  
  // Add more brands here as needed
  // Example:
  // "스타벅스": "/brands/logos/starbucks.png",
  // "이디야": "/brands/logos/ediya.png",
};

/**
 * Get brand logo path by brand name
 * @param brandName - The brand name
 * @returns The logo path, or null if not found
 */
export function getBrandLogoPath(brandName?: string): string | null {
  if (!brandName) return null;
  
  // Try exact match first
  if (brandLogoMap[brandName]) {
    return brandLogoMap[brandName];
  }
  
  // Try partial match (case-insensitive)
  const lowerBrandName = brandName.toLowerCase();
  for (const [key, path] of Object.entries(brandLogoMap)) {
    if (key.toLowerCase() === lowerBrandName) {
      return path;
    }
  }
  
  return null;
}
