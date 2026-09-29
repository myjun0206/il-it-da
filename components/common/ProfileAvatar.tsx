"use client";

import React, { useState, useMemo, useEffect } from "react";

interface ProfileAvatarProps {
  /** 사용자 이름 (initials 생성용) */
  name: string;
  /** 프로필 사진 URL (없으면 initials 표시) */
  avatarUrl?: string | null;
  /** Avatar 크기 (기본값: 'md') */
  size?: "sm" | "md" | "lg" | "xl" | "xxl";
  /** className 추가 (선택사항) */
  className?: string;
  /** 이미지 로드 실패 시 처리 */
  onImageError?: () => void;
}

const SIZES = {
  sm: "w-6 h-6 text-xs",
  md: "w-8 h-8 text-sm",
  lg: "w-12 h-12 text-base",
  xl: "w-16 h-16 text-lg",
  xxl: "w-20 h-20 text-xl",
};

const BG_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-purple-100 text-purple-700",
  "bg-pink-100 text-pink-700",
  "bg-green-100 text-green-700",
  "bg-orange-100 text-orange-700",
  "bg-cyan-100 text-cyan-700",
  "bg-red-100 text-red-700",
  "bg-indigo-100 text-indigo-700",
];

/**
 * 공통 프로필 Avatar 컴포넌트
 *
 * 역할:
 * 1. avatarUrl 있음 → 실제 프로필 사진 표시
 * 2. avatarUrl 없음 → 이름 첫글자(initials) 표시
 * 3. 이미지 로드 실패 → initials fallback
 *
 * HQ/Owner/Staff Header와 ProfileMenu에서 공통으로 사용
 */
export default function ProfileAvatar({
  name,
  avatarUrl,
  size = "md",
  className = "",
  onImageError,
}: ProfileAvatarProps) {
  const [imageError, setImageError] = useState(false);

  // avatarUrl이 변경되면 imageError state 초기화
  // (이전 URL 로드 실패 상태가 새 URL에 영향을 주지 않도록)
  useEffect(() => {
    setImageError(false);
  }, [avatarUrl]);

  // initials 계산: "송채현" → "송"
  const initials = useMemo(() => {
    if (!name) return "?";
    const trimmed = name.trim();
    if (!trimmed) return "?";
    return trimmed.charAt(0).toUpperCase();
  }, [name]);

  // initials 배경색 일관성: 이름 기반 색상 선택
  const bgColorIndex = useMemo(() => {
    const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return hash % BG_COLORS.length;
  }, [name]);

  const sizeClass = SIZES[size];
  const bgColorClass = BG_COLORS[bgColorIndex];

  // 이미지 로드 실패 처리
  const handleImageError = () => {
    setImageError(true);
    onImageError?.();
  };

  // 실제 이미지 표시 (URL 있고 로드 성공)
  if (avatarUrl && !imageError) {
    return (
      <div
        className={`rounded-full overflow-hidden flex items-center justify-center shrink-0 ${sizeClass} ${className}`}
      >
        <img
          src={avatarUrl}
          alt={name}
          loading="lazy"
          onError={handleImageError}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  // Initials fallback (URL 없거나 로드 실패)
  return (
    <div
      className={`rounded-full flex items-center justify-center font-bold shrink-0 ${sizeClass} ${bgColorClass} ${className}`}
    >
      {initials}
    </div>
  );
}
