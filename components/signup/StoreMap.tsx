"use client";

import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Store } from "@/lib/types/store";

interface StoreMapProps {
  stores: Store[];
  selectedStoreIds?: string[];
  onStoreSelect?: (store: Store) => void;
  centerStore?: Store;
  /** 지정하면 모든 마커를 기본/강조 스타일로 그리고, 이 매장 마커를 강조하며 지도 중심으로 이동한다. */
  focusedStoreId?: string | null;
}

// focusedStoreId 사용 시 마커 스타일 (일잇다 green 강조 / 중립 회색)
function markerIcon(isFocused: boolean) {
  const size = isFocused ? 22 : 14;
  const color = isFocused ? "#1c6b52" : "#60736b";
  return {
    content: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></span>`,
    anchor: { x: size / 2 + 3, y: size / 2 + 3 },
  };
}

declare global {
   
  interface Window {
    navermap_authFailure?: () => void;
    naver?: {
      maps: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Map: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Marker: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        LatLng: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        LatLngBounds: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Point: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Size: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Event: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        MarkerClustering: any;
      };
    };
  }
}

type MapStatus = "loading" | "ready" | "missing-key" | "auth-error" | "load-error" | "init-error";

const MAP_SCRIPT_ID = "ilitda-naver-maps-sdk";
const MAP_AUTH_FAILURE_EVENT = "ilitda-naver-map-auth-failure";
let mapSdkPromise: Promise<void> | null = null;
let mapAuthFailed = false;
let mapSdkFailed = false;
let authFailureHandlerInstalled = false;

function isNaverMapsReady(): boolean {
  const maps = window.naver?.maps;
  return Boolean(maps && [maps.Map, maps.Marker, maps.LatLng, maps.LatLngBounds, maps.Size].every((constructor) => typeof constructor === "function")
    && typeof maps.Event?.addListener === "function");
}

function loadNaverMaps(clientId: string): Promise<void> {
  if (mapSdkPromise) return mapSdkPromise;

  if (!authFailureHandlerInstalled) {
    const previousHandler = window.navermap_authFailure;
    window.navermap_authFailure = () => {
      mapAuthFailed = true;
      mapSdkFailed = true;
      mapSdkPromise = null;
      document.getElementById(MAP_SCRIPT_ID)?.remove();
      window.dispatchEvent(new Event(MAP_AUTH_FAILURE_EVENT));
      previousHandler?.();
    };
    authFailureHandlerInstalled = true;
  }

  if (!mapAuthFailed && !mapSdkFailed && isNaverMapsReady()) return Promise.resolve();
  mapAuthFailed = false;
  mapSdkFailed = false;
  mapSdkPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(MAP_SCRIPT_ID) as HTMLScriptElement | null;
    const script = existingScript ?? document.createElement("script");
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      window.removeEventListener(MAP_AUTH_FAILURE_EVENT, onAuthFailure);
    };
    const fail = (message: string) => {
      mapSdkFailed = true;
      cleanup();
      script.remove();
      reject(new Error(message));
    };
    const onLoad = () => {
      if (mapAuthFailed) return fail("NAVER_MAP_AUTH_FAILED");
      if (!isNaverMapsReady()) {
        return fail("NAVER_MAP_LOAD_FAILED");
      }
      cleanup();
      resolve();
    };
    const onError = () => fail("NAVER_MAP_LOAD_FAILED");
    const onAuthFailure = () => fail("NAVER_MAP_AUTH_FAILED");
    const timeout = window.setTimeout(() => fail("NAVER_MAP_LOAD_TIMEOUT"), 15_000);

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    window.addEventListener(MAP_AUTH_FAILURE_EVENT, onAuthFailure);
    if (!existingScript) {
      const url = new URL("https://oapi.map.naver.com/openapi/v3/maps.js");
      url.searchParams.set("ncpKeyId", clientId);
      script.id = MAP_SCRIPT_ID;
      script.src = url.toString();
      script.async = true;
      document.head.appendChild(script);
    }
  });
  void mapSdkPromise.catch(() => { mapSdkPromise = null; });
  return mapSdkPromise;
}

export default function StoreMap({
  stores,
  selectedStoreIds = [],
  onStoreSelect,
  centerStore,
  focusedStoreId,
}: StoreMapProps) {
  const usesFocus = focusedStoreId !== undefined;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersMapRef = useRef<Map<string, any>>(new Map());
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [retryToken, setRetryToken] = useState(0);
  const [mapVersion, setMapVersion] = useState(0);
  const hasNaverApi = mapStatus === "ready";

  // NAVER Maps API 로드
  useEffect(() => {
    let active = true;
    const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID?.trim()
      || process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID?.trim();
    const onAuthFailure = () => { if (active) setMapStatus("auth-error"); };
    window.addEventListener(MAP_AUTH_FAILURE_EVENT, onAuthFailure);

    void Promise.resolve().then(async () => {
      if (!active) return;
      if (!clientId) {
        setMapStatus("missing-key");
        console.warn("[StoreMap] NAVER Maps public key is missing from this build");
        return;
      }
      setMapStatus("loading");
      try {
        await loadNaverMaps(clientId);
        if (active) setMapStatus(mapAuthFailed ? "auth-error" : "ready");
      } catch (error) {
        if (active) setMapStatus(error instanceof Error && error.message === "NAVER_MAP_AUTH_FAILED" ? "auth-error" : "load-error");
      }
    });

    return () => {
      active = false;
      window.removeEventListener(MAP_AUTH_FAILURE_EVENT, onAuthFailure);
    };
  }, [retryToken]);

  // 지도 초기화
  useEffect(() => {
    if (!hasNaverApi || !wrapperRef.current || !containerRef.current || !window.naver?.maps) return;

    const wrapper = wrapperRef.current;
    const container = containerRef.current;
    const { maps } = window.naver;
    const markers = markersMapRef.current;
    let disposed = false;
    let frame = 0;
    let delayedResize = 0;
    let map: typeof mapRef.current = null;
    let resizeObserver: ResizeObserver | undefined;

    const updateMapSize = () => {
      frame = 0;
      if (disposed) return;
      const width = wrapper.clientWidth;
      const height = wrapper.clientHeight;
      if (width <= 0 || height <= 0) return;

      try {
        if (!map) {
          map = new maps.Map(container, {
            center: new maps.LatLng(37.5665, 126.9780),
            size: new maps.Size(width, height),
            zoom: 15,
            minZoom: 8,
            maxZoom: 21,
          });
          mapRef.current = map;
          setMapVersion((version) => version + 1);
          delayedResize = window.setTimeout(scheduleResize, 150);
        }
        const center = map.getCenter();
        map.setSize(new maps.Size(width, height));
        maps.Event.trigger(map, "resize");
        map.setCenter(center);
      } catch (error) {
        console.error("Failed to initialize NAVER Map:", error);
        if (!disposed) setMapStatus("init-error");
      }
    };
    const scheduleResize = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateMapSize);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleResize();
    };

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(wrapper);
    }
    window.addEventListener("resize", scheduleResize);
    window.addEventListener("orientationchange", scheduleResize);
    window.addEventListener("pageshow", scheduleResize);
    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleResize();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(delayedResize);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleResize);
      window.removeEventListener("orientationchange", scheduleResize);
      window.removeEventListener("pageshow", scheduleResize);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      markers.forEach((marker) => marker.setMap(null));
      markers.clear();
      map?.destroy?.();
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [hasNaverApi]);

  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return;
    const { maps } = window.naver;
    const markersToDelete: string[] = [];
    markersMapRef.current.forEach((marker, storeId) => {
      if (!selectedStoreIds.includes(storeId)) {
        marker.setMap(null);
        markersToDelete.push(storeId);
      }
    });
    markersToDelete.forEach((storeId) => markersMapRef.current.delete(storeId));

    const bounds = new maps.LatLngBounds();
    let hasBounds = false;
    selectedStoreIds.forEach(storeId => {
      if (markersMapRef.current.has(storeId)) {
        const store = stores.find((store) => store.id === storeId);
        if (store?.latitude && store?.longitude) {
          bounds.extend(new maps.LatLng(store.latitude, store.longitude));
          hasBounds = true;
        }
        return;
      }

      const store = stores.find(s => s.id === storeId);
      if (!store || !store.latitude || !store.longitude) return;

      const marker = new maps.Marker({
        position: new maps.LatLng(store.latitude, store.longitude),
        map: mapRef.current,
        // 검색 결과 name에 이미 브랜드명이 들어 있으므로 brandName을 다시 붙이지 않는다.
        title: store.name,
        ...(usesFocus ? { icon: markerIcon(false) } : {}),
      });

      // 마커 클릭 이벤트
      maps.Event.addListener(marker, "click", () => {
        if (onStoreSelect) {
          onStoreSelect(store);
        }
      });

      markersMapRef.current.set(storeId, marker);
      bounds.extend(new maps.LatLng(store.latitude, store.longitude));
      hasBounds = true;
    });

    // 3. 지도 위치 자동 조정
    if (hasBounds) {
      if (selectedStoreIds.length === 1) {
        // 1개 선택: 해당 매장을 중심으로
        const store = stores.find(s => s.id === selectedStoreIds[0]);
        if (store?.latitude && store?.longitude) {
          mapRef.current.setCenter(new maps.LatLng(store.latitude, store.longitude));
          mapRef.current.setZoom(15);
        }
      } else if (selectedStoreIds.length > 1) {
        // 2개 이상: 모든 매장이 보이도록
        mapRef.current.fitBounds(bounds, 0, 0, 40, 40);
      }
    } else if (selectedStoreIds.length === 0) {
      // 선택된 매장 없음: 기본 위치로
      const defaultCenter = centerStore ?? stores[0];
      if (defaultCenter?.latitude && defaultCenter?.longitude) {
        mapRef.current.setCenter(new maps.LatLng(defaultCenter.latitude, defaultCenter.longitude));
        mapRef.current.setZoom(15);
      }
    }
  }, [hasNaverApi, mapVersion, selectedStoreIds, stores, centerStore, onStoreSelect, usesFocus]);

  // 강조 마커 동기화 (focusedStoreId를 넘긴 경우에만)
  useEffect(() => {
    if (!usesFocus || !mapRef.current || !window.naver?.maps) return;
    const { maps } = window.naver;

    markersMapRef.current.forEach((marker, storeId) => {
      const isFocused = storeId === focusedStoreId;
      marker.setIcon(markerIcon(isFocused));
      marker.setZIndex(isFocused ? 100 : 1);
    });

    const focused = stores.find((store) => store.id === focusedStoreId);
    if (focused?.latitude && focused?.longitude) {
      mapRef.current.panTo(new maps.LatLng(focused.latitude, focused.longitude));
    }
  }, [hasNaverApi, mapVersion, usesFocus, focusedStoreId, stores, centerStore, selectedStoreIds]);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full min-h-[260px] w-full min-w-0 shrink-0 bg-white"
    >
      <div ref={containerRef} className="absolute inset-0 h-full w-full" aria-label="매장 위치 지도" />
      {/* Fallback for no NAVER API */}
      {!hasNaverApi && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-bg-default)] p-4">
          <div className="max-w-sm text-center text-[var(--color-text-secondary)]" role={mapStatus === "loading" ? "status" : "alert"}>
            <p className="text-sm font-medium mb-2">
              {mapStatus === "loading" ? "지도를 불러오는 중입니다" : mapStatus === "auth-error" ? "지도 인증에 실패했습니다" : "지도를 불러오지 못했습니다"}
            </p>
            {mapStatus !== "loading" && (
              <>
                <p className="text-xs text-[var(--color-text-tertiary)]">매장 검색과 선택은 계속 이용할 수 있습니다.</p>
                {mapStatus !== "missing-key" && (
                  <button
                    type="button"
                    onClick={() => { setMapStatus("loading"); setRetryToken((value) => value + 1); }}
                    className="mt-3 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-(--color-border) bg-(--color-bg-surface) px-3 text-sm font-medium text-(--color-primary) hover:bg-(--color-primary-light)/20 focus-visible:outline-2 focus-visible:outline-(--color-primary)"
                  >
                    <RefreshCw size={16} aria-hidden="true" /> 다시 시도
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
