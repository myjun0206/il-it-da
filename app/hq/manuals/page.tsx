"use client";

import React, { useLayoutEffect, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Filter, MoreVertical, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import HQSidebar from "@/components/hq/HQSidebar";
import HQHeader from "@/components/hq/HQHeader";

// Mock Data
const manualsMockData = {
  manuals: [
    {
      id: 1,
      title: "음료 제조 기본 매뉴얼",
      category: "제조",
      target: "전체 지점",
      lastModified: "2026.09.18",
      status: "배포 중",
    },
    {
      id: 2,
      title: "오픈 업무 매뉴얼",
      category: "매장 운영",
      target: "전체 지점",
      lastModified: "2026.09.15",
      status: "배포 중",
    },
    {
      id: 3,
      title: "위생 관리 매뉴얼",
      category: "위생",
      target: "전체 지점",
      lastModified: "2026.09.10",
      status: "배포 중",
    },
    {
      id: 4,
      title: "신메뉴 제조 가이드",
      category: "제조",
      target: "전체 지점",
      lastModified: "2026.09.20",
      status: "임시저장",
    },
    {
      id: 5,
      title: "POS 장애 대응",
      category: "비상 대응",
      target: "전체 지점",
      lastModified: "2026.08.21",
      status: "수정 필요",
    },
  ],
  stats: {
    total: 24,
    deployed: 21,
    needsUpdate: 3,
  },
};

export default function ManualsPage() {
  const router = useRouter();
  const [userName, setUserName] = useState("본사 관리자");
  const [franchiseName, setFranchiseName] = useState("메가MGC커피");
  const [isReady, setIsReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("전체");
  const [selectedStatus, setSelectedStatus] = useState("전체");

  const categories = ["전체", "제조", "매장 운영", "위생", "비상 대응"];
  const statuses = ["전체", "배포 중", "임시저장", "수정 필요"];

  useLayoutEffect(() => {
    // Check Supabase session
    const checkAuth = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) {
          router.push("/");
          return;
        }

        const user = data.session.user;
        const role = user.user_metadata?.role;

        // Verify user is HQ
        if (role !== "hq") {
          router.push("/");
          return;
        }
      } catch (e) {
        console.error("Auth check failed:", e);
        router.push("/");
      }
    };

    checkAuth();
  }, [router]);

  useEffect(() => {
    // Set user info from metadata
    const setUserInfo = async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getSession();

        if (!data.session?.user) return;

        const user = data.session.user;
        const name = user.user_metadata?.name;

        if (name) {
          setUserName(name);
        }

        if (name && name.includes(" ")) {
          const parts = name.split(" ");
          if (parts[0]) {
            setFranchiseName(parts[0]);
          }
        }

        setIsReady(true);
      } catch (e) {
        console.error("Set user info failed:", e);
        setIsReady(true);
      }
    };

    setUserInfo();
  }, []);

  const handleLogout = async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch (e) {
      console.error("Logout failed:", e);
      router.push("/");
    }
  };

  const handleNewManual = () => {
    // Placeholder for future implementation
    alert("매뉴얼 등록 기능은 추후 구현될 예정입니다.");
  };

  // Filter manuals based on search and filters
  const filteredManuals = manualsMockData.manuals.filter((manual) => {
    const matchesSearch =
      manual.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      manual.category.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === "전체" || manual.category === selectedCategory;

    const matchesStatus =
      selectedStatus === "전체" || manual.status === selectedStatus;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case "배포 중":
        return "bg-green-100 text-green-700";
      case "임시저장":
        return "bg-gray-100 text-gray-700";
      case "수정 필요":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  if (!isReady) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-default)]">
      {/* Sidebar */}
      <HQSidebar
        userName={userName}
        franchiseName={franchiseName}
        onLogout={handleLogout}
        activeMenu="manual"
      />

      {/* Main Content */}
      <div className="lg:ml-[240px]">
        {/* Header */}
        <HQHeader userName={userName} franchiseName={franchiseName} />

        {/* Content */}
        <main className="p-6 lg:p-8 max-w-7xl mx-auto h-[calc(100vh-64px)] overflow-y-auto">
          {/* Page Header */}
          <div className="mb-8 flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)] mb-2">
                매뉴얼 관리
              </h1>
              <p className="text-base text-[var(--color-text-secondary)]">
                전 지점에서 사용하는 업무 매뉴얼을 등록하고 관리하세요.
              </p>
            </div>
            <button
              onClick={handleNewManual}
              className="bg-[var(--color-primary)] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[var(--color-primary-hover)] transition-colors flex items-center gap-2 whitespace-nowrap"
              style={{ minHeight: "44px" }}
            >
              <Plus size={20} />
              새 매뉴얼 등록
            </button>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-12">
            {/* Card 1: Total Manuals */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-surface)] transition-all cursor-pointer">
              <BookOpen
                size={24}
                className="text-[var(--color-primary)] mb-4"
              />
              <p className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
                전체 매뉴얼
              </p>
              <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                {manualsMockData.stats.total}
                <span className="text-base font-normal text-[var(--color-text-secondary)] ml-1">
                  개
                </span>
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                등록된 전체 매뉴얼
              </p>
            </div>

            {/* Card 2: Deployed */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-surface)] transition-all cursor-pointer">
              <BookOpen
                size={24}
                className="text-[var(--color-primary)] mb-4"
              />
              <p className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
                배포 중
              </p>
              <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                {manualsMockData.stats.deployed}
                <span className="text-base font-normal text-[var(--color-text-secondary)] ml-1">
                  개
                </span>
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                현재 지점에서 사용 중
              </p>
            </div>

            {/* Card 3: Needs Update */}
            <div className="bg-white border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-surface)] transition-all cursor-pointer">
              <BookOpen
                size={24}
                className="text-[var(--color-primary)] mb-4"
              />
              <p className="text-base font-semibold text-[var(--color-text-primary)] mb-3">
                수정 필요
              </p>
              <p className="text-3xl font-bold text-[var(--color-text-primary)] mb-2">
                {manualsMockData.stats.needsUpdate}
                <span className="text-base font-normal text-[var(--color-text-secondary)] ml-1">
                  개
                </span>
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                업데이트 확인 필요
              </p>
            </div>
          </div>

          {/* AI Connection Info */}
          <div className="mb-8 bg-[var(--color-primary-light)]/10 border border-[var(--color-primary-light)] rounded-lg p-4 flex items-start gap-3">
            <BookOpen size={20} className="text-[var(--color-primary)] flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[var(--color-text-primary)] text-sm mb-1">
                AI 지식 연동
              </p>
              <p className="text-sm text-[var(--color-text-secondary)]">
                배포된 매뉴얼은 직원 AI 챗봇의 답변 근거로 활용됩니다.
              </p>
            </div>
          </div>

          {/* Manual List Section */}
          <div className="bg-white border border-[var(--color-border)] rounded-lg overflow-hidden flex flex-col">
            {/* Header with Filters */}
            <div className="px-6 py-5 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-[var(--color-text-primary)]">
                  매뉴얼 목록
                </h2>
                <div className="flex items-center gap-3">
                  {/* Search */}
                  <div className="relative flex-1 min-w-48">
                    <Search
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
                    />
                    <input
                      type="text"
                      placeholder="매뉴얼 검색"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 text-sm"
                      style={{ minHeight: "36px" }}
                    />
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap gap-3">
                {/* Category Filter */}
                <div className="flex items-center gap-2">
                  <Filter size={16} className="text-[var(--color-text-secondary)]" />
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="px-3 py-2 border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 text-sm bg-white"
                    style={{ minHeight: "36px" }}
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-2">
                  <select
                    value={selectedStatus}
                    onChange={(e) => setSelectedStatus(e.target.value)}
                    className="px-3 py-2 border border-[var(--color-border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30 text-sm bg-white"
                    style={{ minHeight: "36px" }}
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto flex-1">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-white">
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                      매뉴얼명
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                      카테고리
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                      적용 대상
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                      최종 수정
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                      상태
                    </th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-[var(--color-text-primary)]">
                      관리
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManuals.length > 0 ? (
                    filteredManuals.map((manual) => (
                      <tr
                        key={manual.id}
                        className="border-b border-[var(--color-border)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer last:border-b-0"
                      >
                        <td className="px-6 py-4 text-sm font-medium text-[var(--color-text-primary)]">
                          {manual.title}
                        </td>
                        <td className="px-6 py-4 text-sm text-[var(--color-text-secondary)]">
                          {manual.category}
                        </td>
                        <td className="px-6 py-4 text-sm text-[var(--color-text-secondary)]">
                          {manual.target}
                        </td>
                        <td className="px-6 py-4 text-sm text-[var(--color-text-secondary)]">
                          {manual.lastModified}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-3 py-2 rounded text-sm font-medium inline-block ${getStatusBadgeColor(
                              manual.status
                            )}`}
                          >
                            {manual.status}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <button className="p-2 hover:bg-white rounded-lg transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
                            <MoreVertical size={18} />
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-8 text-center text-[var(--color-text-secondary)]"
                      >
                        검색 결과가 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
