"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Store } from "@/lib/types/store";

interface StoreMapProps {
  stores: Store[];
  selectedStoreIds?: string[];
  onStoreSelect?: (store: Store) => void;
  centerStore?: Store;
}

declare global {
  interface Window {
    naver?: {
      maps: {
        Map: any;
        Marker: any;
        LatLng: any;
        LatLngBounds: any;
        Point: any;
        Event: any;
        MarkerClustering: any;
      };
    };
  }
}

export default function StoreMap({
  stores,
  selectedStoreIds = [],
  onStoreSelect,
  centerStore,
}: StoreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersMapRef = useRef<Map<string, any>>(new Map());
  const [hasNaverApi, setHasNaverApi] = useState(false);
  const [mapInitialized, setMapInitialized] = useState(false);

  // NAVER Maps API 로드
  useEffect(() => {
    if (typeof window === "undefined") return;

    // API가 이미 로드됨
    if (window.naver?.maps) {
      setHasNaverApi(true);
      return;
    }

    const clientId = process.env.NEXT_PUBLIC_NAVER_MAP_CLIENT_ID;
    if (!clientId) {
      console.warn("[StoreMap] NEXT_PUBLIC_NAVER_MAP_CLIENT_ID not configured");
      setHasNaverApi(false);
      return;
    }

    // 스크립트 로드 (NAVER Maps v3 최신 방식: ncpKeyId 사용)
    const script = document.createElement("script");
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`;
    script.async = true;

    script.onload = () => {
      setHasNaverApi(true);
    };

    script.onerror = () => {
      console.error("Failed to load NAVER Maps API");
      setHasNaverApi(false);
    };

    document.head.appendChild(script);

    return () => {
      // 스크립트 제거하지 않음 (재사용)
    };
  }, []);

  // 지도 초기화
  useEffect(() => {
    if (!hasNaverApi || !containerRef.current || mapInitialized) return;
    if (!window.naver?.maps) return;

    try {
      // 센터 설정: 선택된 매장 > 첫 번째 매장 > 서울 시청 (기본)
      const center = centerStore || stores[0] || { latitude: 37.5665, longitude: 126.9780 };
      
      const { maps } = window.naver;
      const mapOptions = {
        center: new maps.LatLng(center.latitude, center.longitude),
        zoom: 15,
        minZoom: 8,
        maxZoom: 21,
      };

      mapRef.current = new maps.Map(containerRef.current, mapOptions);
      setMapInitialized(true);
    } catch (error) {
      console.error("Failed to initialize NAVER Map:", error);
      setMapInitialized(true);
    }
  }, [hasNaverApi, stores, centerStore, mapInitialized]);

  // 마커 업데이트 및 동기화 (selectedStoreIds 변경 시)
  useEffect(() => {
    if (!mapRef.current || !window.naver?.maps) return;

    const { maps } = window.naver;

    // 1. 선택 해제된 마커 제거
    const markersToDelete: string[] = [];
    markersMapRef.current.forEach((marker, storeId) => {
      if (!selectedStoreIds.includes(storeId)) {
        marker.setMap(null);
        markersToDelete.push(storeId);
      }
    });
    markersToDelete.forEach(storeId => markersMapRef.current.delete(storeId));

    // 2. 새로 선택된 매장의 마커 추가
    const bounds = new maps.LatLngBounds();
    let hasBounds = false;

    selectedStoreIds.forEach(storeId => {
      // 이미 마커가 있으면 스킵
      if (markersMapRef.current.has(storeId)) {
        const store = stores.find(s => s.id === storeId);
        if (store?.latitude && store?.longitude) {
          bounds.extend(new maps.LatLng(store.latitude, store.longitude));
          hasBounds = true;
        }
        return;
      }

      // 새 마커 생성
      const store = stores.find(s => s.id === storeId);
      if (!store || !store.latitude || !store.longitude) return;

      const marker = new maps.Marker({
        position: new maps.LatLng(store.latitude, store.longitude),
        map: mapRef.current,
        title: `${store.brandName} ${store.name}`,
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
      const defaultCenter = stores[0];
      if (defaultCenter?.latitude && defaultCenter?.longitude) {
        mapRef.current.setCenter(new maps.LatLng(defaultCenter.latitude, defaultCenter.longitude));
        mapRef.current.setZoom(15);
      }
    }
  }, [selectedStoreIds, stores, onStoreSelect]);

  // cleanup: 컴포넌트 언마운트 시 모든 마커 제거
  useEffect(() => {
    return () => {
      markersMapRef.current.forEach(marker => marker.setMap(null));
      markersMapRef.current.clear();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-white overflow-hidden relative"
    >
      {/* Fallback for no NAVER API */}
      {!hasNaverApi && (
        <div className="w-full h-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
          <div className="text-center text-[var(--color-text-secondary)]">
            <p className="text-sm font-medium mb-2">지도를 사용할 수 없습니다</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              검색을 통해 매장을 선택해주세요
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
