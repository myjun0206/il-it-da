/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface PortalProps {
  children: ReactNode;
}

export function Portal({ children }: PortalProps) {
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  // Portal 컨테이너: 화면 전체를 fixed positioning으로 덮으면서
  // 내부 컨텐츠를 중앙 정렬합니다.
  // inset: 0은 top, right, bottom, left: 0을 의미하며,
  // viewport를 기준으로 절대 위치를 보장합니다.
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          pointerEvents: "auto",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
