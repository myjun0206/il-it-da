"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { Bell, BookOpen, ChevronRight, FileText, LayoutDashboard, LogOut, MoreHorizontal, Plus, Search, Settings2, ShieldCheck, Store, UploadCloud, Users } from "lucide-react";

const tabs = ["대시보드", "매장 가이드", "수칙 문서", "알바생 관리"];
const staff = [
  { name: "김민지", role: "주말 오픈", status: "근무 중", color: "#e2a366" },
  { name: "박준호", role: "평일 마감", status: "대기 중", color: "#8bb5a3" },
  { name: "이서연", role: "주말 마감", status: "휴무", color: "#b8a995" },
];

type UploadState = "idle" | "loading" | "success" | "error";

export default function BossPage() {
  const [activeTab, setActiveTab] = useState("대시보드");
  const [guideText, setGuideText] = useState("");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadMessage, setUploadMessage] = useState("");

  async function uploadGuide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = guideText.trim();
    if (!text) {
      setUploadState("error");
      setUploadMessage("가이드 내용을 입력해주세요.");
      return;
    }
    setUploadState("loading");
    setUploadMessage("");
    try {
      const response = await fetch("/api/rag/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, metadata: { store: "moonlight-seongsu", type: "guide" } }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "저장에 실패했습니다.");
      setGuideText("");
      setUploadState("success");
      setUploadMessage("가이드가 저장되었습니다.");
    } catch (error) {
      setUploadState("error");
      setUploadMessage(error instanceof Error ? error.message : "가이드 저장에 실패했습니다.");
    }
  }

  return (
    <div className="dashboard-shell min-h-screen text-[#24362e]">
      <aside className="hidden w-64 shrink-0 border-r border-[#dfe7dc] bg-[#f7f9f3] px-5 py-7 lg:block">
        <Link href="/" className="mb-12 flex items-center gap-3 px-2"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1c6b52] text-white"><Store size={18} /></span><span className="text-xl font-semibold tracking-[-0.04em]">일잇다</span></Link>
        <p className="px-3 text-[11px] font-bold tracking-[0.14em] text-[#91a49a]">WORKSPACE</p>
        <nav className="mt-3 space-y-1">{tabs.map((tab, index) => <button key={tab} onClick={() => setActiveTab(tab)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold ${activeTab === tab ? "bg-[#dceade] text-[#1c6b52]" : "text-[#789086] hover:bg-[#edf3ea]"}`}>{index === 0 ? <LayoutDashboard size={17} /> : index === 1 ? <BookOpen size={17} /> : index === 2 ? <FileText size={17} /> : <Users size={17} />}{tab}{activeTab === tab && <ChevronRight className="ml-auto" size={15} />}</button>)}</nav>
        <div className="mt-48"><button className="flex w-full items-center gap-3 px-3 py-3 text-sm font-semibold text-[#789086]"><Settings2 size={17} /> 설정</button><button className="flex w-full items-center gap-3 px-3 py-3 text-sm font-semibold text-[#789086]"><LogOut size={17} /> 로그아웃</button></div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex h-[76px] items-center justify-between border-b border-[#e3e9df] bg-white/80 px-5 sm:px-8 lg:px-12"><div><p className="text-xs font-medium text-[#91a49a]">WEDNESDAY, SEP 04, 2026</p><h1 className="mt-1 text-lg font-bold tracking-[-0.03em]">안녕하세요, 김사장님</h1></div><div className="flex items-center gap-3"><button className="hidden h-10 w-10 items-center justify-center rounded-xl border border-[#e2e9df] text-[#779086] sm:flex"><Search size={17} /></button><button className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#e2e9df] text-[#779086]"><Bell size={17} /><span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#d4774d]" /></button><div className="hidden h-9 w-9 items-center justify-center rounded-full bg-[#e5c6a7] text-xs font-bold text-[#754d32] sm:flex">KS</div></div></header>
        <div className="border-b border-[#e3e9df] bg-white px-5 pt-4 lg:hidden"><div className="flex gap-5 overflow-x-auto">{tabs.map(tab => <button key={tab} onClick={() => setActiveTab(tab)} className={`whitespace-nowrap border-b-2 pb-3 text-xs font-bold ${activeTab === tab ? "border-[#1c6b52] text-[#1c6b52]" : "border-transparent text-[#91a49a]"}`}>{tab}</button>)}</div></div>
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12"><div className="mb-8 flex items-end justify-between"><div><p className="text-sm font-semibold text-[#638174]">MOONLIGHT COFFEE · 성수점</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.06em]">{activeTab === "대시보드" ? "매장 현황" : activeTab}</h2></div><button onClick={() => setActiveTab("매장 가이드")} className="hidden items-center gap-2 rounded-xl bg-[#1c6b52] px-4 py-3 text-xs font-bold text-white sm:flex"><Plus size={16} />새로 만들기</button></div>
          {activeTab === "대시보드" ? <Dashboard /> : activeTab === "매장 가이드" ? <GuideUploader guideText={guideText} setGuideText={setGuideText} uploadGuide={uploadGuide} uploadState={uploadState} uploadMessage={uploadMessage} /> : <TabPlaceholder tab={activeTab} />}
        </div>
      </main>
    </div>
  );
}

function Dashboard() { return <><div className="grid gap-4 sm:grid-cols-3"><Stat label="오늘 근무 인원" value="3명" detail="정상 운영 중" icon={<Users size={18} />} /><Stat label="등록된 가이드" value="12개" detail="지난달보다 2개 추가" icon={<BookOpen size={18} />} /><Stat label="문서 기반 답변률" value="94.8%" detail="이번 주 평균" icon={<ShieldCheck size={18} />} /></div><div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]"><section className="rounded-2xl border border-[#e1e9df] bg-white p-5 sm:p-6"><div className="flex items-center justify-between"><div><h3 className="font-bold">오늘의 근무자</h3><p className="mt-1 text-xs text-[#8aa097]">2026. 09. 04 금요일</p></div><button className="text-xs font-bold text-[#1c6b52]">전체 보기 <ChevronRight className="inline" size={14} /></button></div><div className="mt-5 divide-y divide-[#edf1eb]">{staff.map(person => <div key={person.name} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white" style={{ backgroundColor: person.color }}>{person.name.slice(0, 1)}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold">{person.name}</p><p className="mt-0.5 text-xs text-[#8aa097]">{person.role}</p></div><span className="rounded-full bg-[#e1f1e6] px-2.5 py-1 text-[11px] font-bold text-[#318061]">{person.status}</span><MoreHorizontal size={17} className="text-[#b1beb6]" /></div>)}</div></section><section className="rounded-2xl border border-[#e1e9df] bg-[#f3f7ef] p-5 sm:p-6"><div className="flex items-center justify-between"><div><h3 className="font-bold">최근 업데이트</h3><p className="mt-1 text-xs text-[#8aa097]">매장 지식 베이스</p></div><FileText className="text-[#7ba08c]" size={20} /></div><div className="mt-5 space-y-3"><Activity title="주말 마감 체크리스트" meta="가이드 · 2시간 전" /><Activity title="식자재 검수 수칙 v2" meta="수칙 문서 · 어제" /><Activity title="신메뉴 제조 가이드" meta="가이드 · 3일 전" /></div></section></div></> }
function Stat({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) { return <div className="rounded-2xl border border-[#e1e9df] bg-white p-5"><div className="flex items-center justify-between text-[#6c9180]"><span className="text-xs font-bold">{label}</span><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#eaf3e9]">{icon}</span></div><p className="mt-5 text-3xl font-semibold tracking-[-0.06em]">{value}</p><p className="mt-1 text-xs font-medium text-[#8aa097]">{detail}</p></div> }
function Activity({ title, meta }: { title: string; meta: string }) { return <div className="flex items-center gap-3 rounded-xl bg-white/75 p-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e3eee0] text-[#4d826b]"><FileText size={15} /></span><div><p className="text-xs font-bold">{title}</p><p className="mt-1 text-[11px] text-[#8aa097]">{meta}</p></div><ChevronRight className="ml-auto text-[#9cb2a3]" size={15} /></div> }
function GuideUploader({ guideText, setGuideText, uploadGuide, uploadState, uploadMessage }: { guideText: string; setGuideText: (value: string) => void; uploadGuide: (event: FormEvent<HTMLFormElement>) => void; uploadState: UploadState; uploadMessage: string }) { return <form onSubmit={uploadGuide} className="max-w-3xl rounded-2xl border border-[#e1e9df] bg-white p-5 sm:p-7"><div className="flex items-start gap-4"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e3eee0] text-[#4d826b]"><UploadCloud size={20} /></span><div><h3 className="font-bold">새 매장 가이드 등록</h3><p className="mt-1 text-sm text-[#82978d]">알바생 질문에 활용할 업무 절차와 운영 노하우를 입력해주세요.</p></div></div><textarea value={guideText} onChange={event => setGuideText(event.target.value)} placeholder="예: 마감할 때는 먼저 에스프레소 머신을 세척하고..." className="mt-6 min-h-48 w-full resize-y rounded-xl border border-[#dfe8dd] bg-[#fafcf8] p-4 text-sm leading-6 text-[#345246] outline-none placeholder:text-[#a5b1aa] focus:border-[#6da58b]" /><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p role="status" className={`text-sm font-semibold ${uploadState === "error" ? "text-[#c7664d]" : "text-[#3b8062]"}`}>{uploadMessage}</p><button type="submit" disabled={uploadState === "loading"} className="flex items-center gap-2 rounded-xl bg-[#1c6b52] px-5 py-3 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60"><UploadCloud size={16} />{uploadState === "loading" ? "저장 중..." : "가이드 저장"}</button></div></form> }
function TabPlaceholder({ tab }: { tab: string }) { return <section className="flex min-h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#cddbcf] bg-[#f8faf6] text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e3eee0] text-[#4d826b]"><UploadCloud size={24} /></span><h3 className="mt-5 text-lg font-bold">{tab}을 준비하고 있어요</h3><p className="mt-2 text-sm text-[#82978d]">새로운 내용을 등록하면 알바생의 질문에 바로 활용됩니다.</p></section> }
