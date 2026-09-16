# 일잇다 전면 리디자인 - 구현 계획

## 0. 현재 프로젝트 상태 분석

### 현재 라우팅 구조
```
/ (홈 랜딩 페이지)
├─ /boss (사장님 대시보드)
└─ /staff (알바생 AI 챗봇)
```

### 현재 컴포넌트 구조
**인라인 컴포넌트만 존재 (별도 컴포넌트 파일 없음)**
- `app/page.tsx`: 랜딩 페이지 (인라인)
- `app/boss/page.tsx`: 사장님 대시보드 (인라인, 700줄)
- `app/staff/page.tsx`: 알바생 AI 챗봇 (인라인, 400줄)
- 공통 컴포넌트 폴더 없음

### 현재 기능 및 데이터 구조

#### Boss/Owner Page (사장님)
✅ **구현되어 있는 기능:**
1. Sidebar navigation (고정 폭 64)
2. Header with greeting
3. Tab system ("대시보드", "매장 가이드", "수칙 문서", "알바생 관리")
4. Dashboard:
   - Stat cards (오늘 근무 인원, 등록된 가이드, 문서 기반 답변률)
   - 오늘의 근무자 목록
   - 최근 업데이트 활동 로그
5. Guide Uploader (API: POST /api/rag/upload)
6. Placeholder tabs
7. 모바일 탭 네비게이션

**Mock Data:**
```
staff: [
  { name: "김민지", role: "주말 오픈", status: "근무 중", color: "#e2a366" },
  { name: "박준호", role: "평일 마감", status: "대기 중", color: "#8bb5a3" },
  { name: "이서연", role: "주말 마감", status: "휴무", color: "#b8a995" },
]
```

#### Staff Page (알바생)
✅ **구현되어 있는 기능:**
1. AI Chatbot interface
2. Message history
3. RAG query integration (API: POST /api/rag/query)
4. Message status badges ("매뉴얼 기반 답변", "확인 권장", "관리자 확인 필요")
5. Quick question suggestions
6. Error handling
7. Mobile-responsive design (768px 중심)

### 현재 색상 시스템

**주요 컬러:**
- Primary Green: `#1c6b52`, `#0C9D81` (accent)
- Text Primary: `#24362e`, `#11211c`
- Text Secondary: `#60736b`, `#72837b`
- Border: `#dfe7dc`, `#e1e9df`
- Background: `#f7f9f5`, `#f7f8f2`
- Neutral: `#e2a366` (brown/beige - TO REPLACE with Deep Navy)

**현재 문제점:**
- Brown/Beige 컬러 사용 중 (`#e2a366`, `#b8a995`, `#754d32` 등)
- Color token이 CSS에 정의되지 않고 인라인으로 사용

### 현재 기술 스택
- **Framework:** Next.js 16.3.4, React 19.2.8
- **Styling:** Tailwind CSS 4
- **State Management:** React useState (local)
- **Backend:** Supabase + Pinecone + LangChain
- **Auth:** ❌ 없음 (구현 필요)
- **Icons:** Lucide React
- **API:** RAG 기반 (upload, query)

**의존성:**
```
@langchain/openai
@langchain/community
@pinecone-database/pinecone
@supabase/ssr
@supabase/supabase-js
lucide-react
tailwindcss
```

### 현재 반응형 설계
- Desktop-first 접근 (lg: breakpoint 중심)
- Mobile: 축소된 UI (모바일 navbar)
- Tablet: 혼합 UI
- 일관성 없는 간격과 패딩

---

## 1. 유지할 기능

### ✅ 반드시 보존
1. **RAG 시스템**
   - `/api/rag/upload` - 가이드 업로드
   - `/api/rag/query` - AI 질문 및 답변
   - LangChain + Pinecone 통합
   - 벡터 임베딩 및 유사도 검색

2. **Boss/Owner 기존 기능**
   - 탭 네비게이션 시스템
   - 근무자 관리
   - 가이드 업로드
   - 활동 로그
   - 통계 카드 (KPI)

3. **Staff 기존 기능**
   - AI 챗봇 인터페이스
   - 메시지 히스토리
   - 빠른 질문 제안
   - 상태 배지 시스템

4. **Supabase 연결**
   - 백엔드 연동 유지
   - 마이그레이션 안 함

### ⚠️ 조건부 재사용
1. **Sidebar 구조**
   - 개념은 유지하되 내용 확장
   - 역할별 다른 메뉴 구조

2. **Header 디자인**
   - 기본 구조 유지
   - 컬러/타이포그래피 업데이트

---

## 2. 변경할 파일 목록

### 🔄 수정 대상 (기존 기능 유지하면서 리디자인)

**우선순위 HIGH:**
- `app/page.tsx` - 로그인 기반 새 랜딩 페이지로 전환
- `app/globals.css` - 컬러 토큰 추가, 테마 재정의
- `app/layout.tsx` - 인증 상태별 레이아웃 분기
- `app/boss/page.tsx` - 새 Design System 적용 + 메뉴 확장
- `app/staff/page.tsx` - 새 Design System 적용 + 레이아웃 개선

**우선순위 MEDIUM:**
- `app/boss/` 및 `app/staff/` - 하위 페이지 추가
  - `/signup/*` - 회원가입 flow
  - `/owner/approvals` - 알바생 승인
  - `/hq/approvals` - 사장님 승인 (새로운)

---

## 3. 새로 만들 파일/폴더

### 📁 폴더 구조 (제안)

```
app/
├── (auth)/                    # 인증 전 페이지들
│   ├── layout.tsx
│   ├── login/
│   │   └── page.tsx
│   └── signup/
│       ├── layout.tsx
│       ├── role/page.tsx
│       ├── terms/page.tsx
│       ├── profile/page.tsx
│       ├── organization/page.tsx
│       ├── stores/page.tsx
│       ├── verification/page.tsx
│       ├── pending/page.tsx
│       └── complete/page.tsx
│
├── (app)/                     # 인증 후 페이지들
│   ├── layout.tsx            # AppShell
│   ├── hq/                   # 본사
│   │   ├── layout.tsx
│   │   ├── page.tsx          # 대시보드
│   │   ├── approvals/page.tsx
│   │   ├── manuals/page.tsx
│   │   ├── stores/page.tsx
│   │   ├── members/page.tsx
│   │   └── settings/page.tsx
│   │
│   ├── owner/                # 사장님
│   │   ├── layout.tsx
│   │   ├── page.tsx          # 대시보드
│   │   ├── guides/page.tsx
│   │   ├── rules/page.tsx
│   │   ├── staff/page.tsx
│   │   ├── approvals/page.tsx
│   │   └── settings/page.tsx
│   │
│   └── staff/                # 알바생
│       ├── layout.tsx
│       ├── page.tsx          # 홈
│       ├── chat/page.tsx
│       ├── manuals/page.tsx
│       └── profile/page.tsx
│
├── api/                       # 백엔드 API (기존 유지)
│   └── rag/
│       ├── upload/route.ts
│       └── query/route.ts
│
├── components/                # 공통 컴포넌트 (NEW)
│   ├── common/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── Dialog.tsx
│   │   ├── Tabs.tsx
│   │   └── ...
│   ├── layout/
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   ├── MobileNavigation.tsx
│   │   └── ...
│   └── ui/
│       ├── StatusBadge.tsx
│       ├── RoleCard.tsx
│       ├── StoreCard.tsx
│       └── ...
│
├── lib/                       # 유틸리티
│   ├── constants/
│   │   ├── colors.ts         # 컬러 토큰
│   │   ├── spacing.ts        # spacing system
│   │   └── breakpoints.ts
│   ├── types/                # (기존 유지)
│   │   ├── auth.ts           # (NEW)
│   │   ├── user.ts           # (NEW)
│   │   ├── store.ts          # (NEW)
│   │   ├── approval.ts       # (NEW)
│   │   └── manual.ts         # (기존 RAG types)
│   ├── hooks/
│   │   ├── useAuth.ts        # (NEW)
│   │   ├── useRole.ts        # (NEW)
│   │   └── ...
│   ├── data/
│   │   ├── mockUsers.ts      # (NEW)
│   │   ├── mockStores.ts     # (NEW)
│   │   ├── mockApprovals.ts  # (NEW)
│   │   └── ...
│   ├── rag/                  # (기존 유지)
│   ├── supabase/             # (기존 유지)
│   └── ...
│
└── styles/
    └── globals.css           # 수정
```

### 📄 신규 파일 상세

**Design System Files:**
- `lib/constants/colors.ts` - 컬러 토큰 정의
- `lib/constants/spacing.ts` - 공통 spacing
- `lib/constants/breakpoints.ts` - 반응형 브레이크포인트

**Common Components:**
- `components/common/Button.tsx` - 5가지 variant
- `components/common/Input.tsx` - 텍스트, 비밀번호, 서치
- `components/common/Card.tsx` - 기본 카드
- `components/common/Badge.tsx` - 상태 배지
- `components/common/Modal.tsx` - 모달
- `components/common/Dialog.tsx` - 확인 대화
- `components/common/Tabs.tsx` - 탭 컴포넌트
- `components/common/EmptyState.tsx` - 빈 상태
- `components/common/LoadingState.tsx` - 로딩

**Layout Components:**
- `components/layout/AppShell.tsx` - 전체 레이아웃 (인증 후)
- `components/layout/Sidebar.tsx` - 사이드바 (역할별)
- `components/layout/Header.tsx` - 헤더
- `components/layout/MobileNavigation.tsx` - 모바일 하단 네비

**Auth Pages:**
- `app/(auth)/login/page.tsx` - 로그인
- `app/(auth)/signup/role/page.tsx` - 회원 유형 선택
- `app/(auth)/signup/terms/page.tsx` - 약관 동의
- `app/(auth)/signup/profile/page.tsx` - 기본 정보
- `app/(auth)/signup/organization/page.tsx` - 조직 선택 (본사용)
- `app/(auth)/signup/stores/page.tsx` - 지점 선택
- `app/(auth)/signup/verification/page.tsx` - 인증
- `app/(auth)/signup/pending/page.tsx` - 승인 대기
- `app/(auth)/signup/complete/page.tsx` - 가입 완료

**HQ Pages (본사):**
- `app/(app)/hq/page.tsx` - 본사 대시보드
- `app/(app)/hq/approvals/page.tsx` - 사장님 승인 관리
- `app/(app)/hq/manuals/page.tsx` - 공통 매뉴얼 관리
- `app/(app)/hq/stores/page.tsx` - 지점 관리
- `app/(app)/hq/members/page.tsx` - 구성원 관리
- `app/(app)/hq/settings/page.tsx` - 설정

**Owner Pages (사장님):**
- `app/(app)/owner/page.tsx` - 대시보드 (기존 /boss 마이그레이션)
- `app/(app)/owner/guides/page.tsx` - 매장 가이드 (기존 기능 유지)
- `app/(app)/owner/rules/page.tsx` - 수칙 문서
- `app/(app)/owner/staff/page.tsx` - 알바생 관리
- `app/(app)/owner/approvals/page.tsx` - 알바생 승인 요청
- `app/(app)/owner/settings/page.tsx` - 설정

**Staff Pages (알바생):**
- `app/(app)/staff/page.tsx` - 홈
- `app/(app)/staff/chat/page.tsx` - AI 챗봇 (기존 /staff 마이그레이션)
- `app/(app)/staff/manuals/page.tsx` - 매뉴얼
- `app/(app)/staff/profile/page.tsx` - 내 정보

**Type Definitions (새로):**
- `lib/types/auth.ts` - 인증 타입
- `lib/types/user.ts` - 사용자 타입
- `lib/types/store.ts` - 지점 타입
- `lib/types/approval.ts` - 승인 요청 타입

**Mock Data (새로):**
- `lib/data/mockUsers.ts`
- `lib/data/mockStores.ts`
- `lib/data/mockApprovals.ts`

---

## 4. 삭제/Deprecated 파일

❌ **삭제할 파일:**
- 현재 형태의 `app/page.tsx` (내용 전면 변경)
- 현재 형태의 `app/boss/page.tsx` (경로 이동 + 확장)
- 현재 형태의 `app/staff/page.tsx` (경로 이동 + 개선)

⚠️ **수정하되 유지할 파일:**
- `app/api/rag/*` (완전 유지)
- `lib/rag/*` (완전 유지)
- `lib/supabase/*` (완전 유지)
- `package.json` (의존성 검토 후 필요하면 추가)

---

## 5. 데이터 모델 설계 (Frontend)

### User Model
```typescript
type UserRole = "hq" | "owner" | "staff";

type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  profileImage?: string;
  createdAt: Date;
  status: "active" | "pending" | "rejected" | "suspended";
};

// 사용자는 여러 지점을 가질 수 있음
type UserStoreRelation = {
  userId: string;
  storeId: string;
  joinedAt: Date;
  status: "active" | "pending" | "rejected";
  approvedAt?: Date;
  approvedBy?: string; // 승인자 ID
};
```

### Store Model
```typescript
type Store = {
  id: string;
  brandId: string;
  name: string;
  address: string;
  latitude?: number;
  longitude?: number;
  manager?: string;
  phone?: string;
  createdAt: Date;
  manualCount: number;
  memberCount: number;
};
```

### Approval Request Model
```typescript
type ApprovalStatus = "pending" | "approved" | "rejected";

type ApprovalRequest = {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  requesterRole: UserRole;
  storeId: string;
  storeName: string;
  requestedAt: Date;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
};
```

### Manual Model (기존 RAG 타입과 통합)
```typescript
type Manual = {
  id: string;
  title: string;
  content: string;
  category: string;
  storeId?: string;        // null이면 공통 매뉴얼
  brandId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  embeddingId?: string;    // Pinecone ID
};
```

---

## 6. 인증 흐름 설계 (Frontend State)

### 상태 관리 전략

**현재 상태:**
- ❌ 중앙 인증 상태 없음
- 각 페이지가 독립적

**변경 사항:**
- ✅ 전역 인증 상태 필요
- `useAuth()` hook 구현
- SessionStorage 또는 Context API 사용

```typescript
type AuthState = {
  isAuthenticated: boolean;
  user: User | null;
  role: UserRole | null;
  isLoading: boolean;
  error: string | null;
};

// hooks/useAuth.ts
export function useAuth() {
  // 구현 TBD
}
```

---

## 7. 색상 시스템 업데이트

### 신규 컬러 팔레트

**Primary Colors:**
- Green Primary: `#1c6b52` (유지)
- Green Light: `#e3eee0`
- Green Accent: `#0C9D81` (유지)

**Secondary Colors (Brown → Deep Navy):**
- Deep Navy: `#1a3a4a` (NEW - 기존 Brown `#754d32` 교체)
- Navy Light: `#2d5463` (NEW)
- Navy Lighter: `#4a7a93` (NEW)

**Text Colors:**
- Text Primary (Dark): `#0d1117` (Deep Navy 계열)
- Text Secondary: `#60736b` (유지)
- Text Tertiary: `#8aa097`

**Status Colors:**
- Success: `#1c6b52`
- Warning: `#e8a745` (제한적 사용)
- Error: `#c53030`
- Info: `#0066cc`

**Neutral:**
- White: `#ffffff`
- Off White: `#f9fafb`
- Light Mint: `#f0f9f6`
- Border: `#dfe7dc`

### 구현 방식

**`lib/constants/colors.ts`:**
```typescript
export const colors = {
  primary: {
    green: "#1c6b52",
    greenLight: "#e3eee0",
    accent: "#0C9D81",
  },
  secondary: {
    navy: "#1a3a4a",
    navyMedium: "#2d5463",
    navyLight: "#4a7a93",
  },
  text: {
    primary: "#0d1117",
    secondary: "#60736b",
    tertiary: "#8aa097",
  },
  status: {
    success: "#1c6b52",
    warning: "#e8a745",
    error: "#c53030",
    info: "#0066cc",
  },
  neutral: {
    white: "#ffffff",
    offWhite: "#f9fafb",
    lightMint: "#f0f9f6",
    border: "#dfe7dc",
  },
};
```

**`app/globals.css` 업데이트:**
```css
:root {
  --color-primary-green: #1c6b52;
  --color-secondary-navy: #1a3a4a;
  --color-text-primary: #0d1117;
  /* ... */
}
```

---

## 8. 구현 순서 (PHASE별)

### PHASE 1: Design System & Foundation (1주)
**목표:** 공통 컴포넌트, 레이아웃, 타입 정의

**작업:**
1. `lib/constants/` 폴더 생성 및 색상/spacing 정의
2. `lib/types/` 폴더 생성 (auth, user, store, approval)
3. `components/common/` 생성
   - Button (5 variants)
   - Input / PasswordInput
   - Card / Badge
   - Modal / Dialog / Tabs
   - EmptyState / LoadingState
4. `components/layout/` 생성
   - AppShell 기본 구조
   - Sidebar 스켈레톤
   - Header 스켈레톤
5. `app/globals.css` 업데이트 (색상 토큰)
6. ✅ Build & Lint 확인

**결과물:** 컴포넌트 스토리북 같은 상태

---

### PHASE 2: Authentication Flow (2주)
**목표:** 로그인, 회원가입 완전 구현 (mock API 기반)

**작업:**
1. `lib/data/mock*` 파일 생성 (mock 데이터)
2. `lib/hooks/useAuth.ts` 구현
3. `app/(auth)/` 구조 생성
   - `login/page.tsx`
   - `signup/role/page.tsx`
   - `signup/terms/page.tsx`
   - `signup/profile/page.tsx`
   - `signup/organization/page.tsx`
   - `signup/stores/page.tsx`
   - `signup/verification/page.tsx`
   - `signup/pending/page.tsx`
   - `signup/complete/page.tsx`
4. 각 페이지에 Stepper UI 추가
5. Form validation
6. ✅ Build & Lint 확인

**결과물:** 전체 가입 flow 작동 (승인 대기까지)

---

### PHASE 3: AppShell & Routing (1주)
**목표:** 인증 후 공통 레이아웃 완성

**작업:**
1. `app/(app)/layout.tsx` 구현
   - Desktop: Sidebar + Header + Main
   - Tablet: Compact Sidebar
   - Mobile: Top Header + Bottom Nav
2. `components/layout/AppShell.tsx` 구현
3. `components/layout/Sidebar.tsx` (역할별 메뉴)
4. `components/layout/Header.tsx` (검색, 알림, 프로필)
5. `components/layout/MobileNavigation.tsx`
6. 라우팅 보호 (useAuth + redirect)
7. ✅ Build & Lint 확인

**결과물:** 모든 대시보드 페이지가 공통 shell 사용

---

### PHASE 4: HQ Dashboard (1주)
**목표:** 본사용 대시보드 (새로운 기능)

**작업:**
1. `app/(app)/hq/page.tsx` - 대시보드
   - Summary cards
   - 승인 대기 요청
   - 최근 지점 활동
2. `app/(app)/hq/approvals/page.tsx` - 사장님 승인
   - Tabs (전체, 대기, 완료, 거절)
   - Approval card
   - Detail modal
3. `app/(app)/hq/manuals/page.tsx` - 매뉴얼 관리
4. `app/(app)/hq/stores/page.tsx` - 지점 관리
5. `app/(app)/hq/members/page.tsx` - 구성원
6. 기본 기능만 구현 (CRUD는 mock)
7. ✅ Build & Lint 확인

**결과물:** 본사 대시보드 UI 완성

---

### PHASE 5: Owner Dashboard Migration & Enhancement (2주)
**목표:** 기존 boss 페이지 마이그레이션 + 새 기능 추가

**작업:**
1. 기존 `/boss` 페이지의 기능을 `/owner`로 마이그레이션
   - 대시보드 (기존 기능 유지)
   - 매장 가이드 (기존 RAG 유지)
   - 수칙 문서
   - 알바생 관리
2. 새 페이지 추가:
   - `owner/approvals/page.tsx` - 직원 승인 요청
   - `owner/settings/page.tsx`
3. 기존 RAG 업로드 기능 유지
4. Design System 적용
5. ✅ Build & Lint 확인

**결과물:** 사장님 대시보드 완전 작동

---

### PHASE 6: Staff Dashboard & Chat (1.5주)
**목표:** 기존 staff 페이지 마이그레이션 + 개선

**작업:**
1. 기존 `/staff` 페이지를 `/staff/chat`으로 마이그레이션
   - AI 챗봇 (기존 RAG 쿼리 유지)
   - Design System 적용
2. `/staff/page.tsx` - 홈 대시보드
   - 인사말
   - 현재 매장 정보
   - 빠른 액션
3. `/staff/manuals/page.tsx` - 매뉴얼 목록
4. `/staff/profile/page.tsx` - 내 정보
5. ✅ Build & Lint 확인

**결과물:** 직원 전체 흐름 작동

---

### PHASE 7: Responsive Design Polish (1주)
**목표:** 모든 페이지 반응형 완성

**작업:**
1. Mobile 우선 재검토
2. 태블릿 중간 레이아웃 최적화
3. Desktop 1440px+ 최적화
4. 모든 모달/다이얼로그 반응형
5. 터치 타겟 44px 확인
6. 텍스트 overflow 처리
7. 이미지/아이콘 스케일
8. ✅ 모든 breakpoint 테스트

**결과물:** 320px ~ 1920px 모두 안전한 UI

---

### PHASE 8: Accessibility & Polish (1주)
**목표:** WCAG 준수, 상호작용 개선

**작업:**
1. Keyboard navigation 테스트
2. Focus trap in modals
3. Screen reader 레이블 추가
4. ARIA 속성 검토
5. Color contrast 확인
6. Form label + input 연결
7. Error message 개선
8. Loading states 통일
9. Hover/active/focus 상태 모두에 적용
10. `prefers-reduced-motion` 고려
11. ✅ Lighthouse 점수 90+ 목표

**결과물:** 접근성 우수 서비스

---

### PHASE 9: Final Integration & Testing (1주)
**목표:** 전체 흐름 테스트, 마이그레이션

**작업:**
1. 전체 user flow 테스트
   - 로그인 → 가입 → 역할별 대시보드
2. API 통합 확인
   - Supabase 인증 연동 (mock → 실제)
   - RAG 쿼리 작동
   - 가이드 업로드 작동
3. 성능 최적화
   - 번들 사이즈 확인
   - 이미지 최적화
   - Code splitting
4. 최종 빌드 테스트
5. 배포 체크리스트

**결과물:** 프로덕션 준비 완료

---

## 9. 기존 기능 보존 확인

### ✅ RAG System (유지)
```
/api/rag/upload  → POST로 가이드 저장
/api/rag/query   → POST로 질문하고 답변 받기
```
**마이그레이션:** Owner guide form & Staff chat에서 사용 계속

### ✅ Supabase Integration (유지)
**마이그레이션:** 인증 로직 추가 (필요시)

### ✅ Mock Data 구조 유지
**확장:** User, Store, Approval 모델 추가

### ✅ 반응형 설계
**개선:** 통일된 breakpoint, spacing system

---

## 10. 새 로고 활용 방안

**위치:**
1. 로그인 페이지 - 왼쪽 영역 중앙 (크게)
2. 헤더 - 좌측 (작게)
3. 모바일 - 헤더/앱바 (작게)
4. 배경 - abstract line graphic (매우 옅게)

**파일:**
- `public/logo-main.svg` - 전체 로고
- `public/logo-icon.svg` - 아이콘만
- 현재 프로젝트에 로고 asset이 없으므로 생성 또는 파일 추가 필요

---

## 11. 미정사항 & 확인 필요

### 🔍 Backend 상태 확인 필요
1. Supabase 테이블 스키마 (users, stores, approvals 등)
2. 현재 인증 구현 여부
3. RAG 쿼리 API의 정확한 응답 구조
4. 지도 API 연동 계획

### 🔍 디자인 확정 필요
1. 새 로고 asset 파일 제공
2. 심화 컬러 (Deep Navy) 정확한 색상값 확인
3. Font family (Geist Sans 유지?)
4. 로그인 페이지 왼쪽 배경 그래픽 스타일

### 🔍 기능 우선순위 확인
1. 지도 기능 (지점 선택)은 Phase 3에 포함할지 연기할지
2. 소셜 로그인 (Google, Kakao, Naver) 순서
3. 실시간 알림 구현 시기
4. 마이그레이션 전략 (기존 데이터 어떻게 처리)

---

## 12. 리스크 & 완화 전략

### ⚠️ 리스크 1: 기존 기능 손실
**완화:** 모든 RAG API, 데이터 구조 먼저 분석 후 시작

### ⚠️ 리스크 2: 인증 구현 지연
**완화:** Mock 인증부터 시작, 실제 Supabase 인증은 PHASE 9에

### ⚠️ 리스크 3: 반응형 재작업
**완화:** PHASE 7에서 모든 breakpoint 검수

### ⚠️ 리스크 4: 성능 저하
**완화:** 번들 사이즈 모니터링, code splitting 적용

---

## 13. 검수 체크리스트 (각 Phase 마다)

- [ ] ESLint 0 errors
- [ ] TypeScript 0 errors
- [ ] Next.js build 성공
- [ ] 모든 페이지 로드 확인
- [ ] 주요 인터랙션 작동 확인
- [ ] 모바일/태블릿/데스크톱 기본 보임
- [ ] 색상 시스템 일관성
- [ ] 컴포넌트 재사용성 검토

---

## 최종 결론

**현재 상태:** 
- 3개 페이지, 인라인 컴포넌트, mock 데이터

**변환 목표:**
- 9개 role/flow 완전 구현
- 30+ 공통 컴포넌트화
- 통일된 Design System
- 모든 반응형 완성
- WCAG 접근성 준수

**예상 소요 시간:**
- 전체 약 9-10주
- 각 phase 1-2주씩

**다음 단계:**
1. ✅ 이 계획안 사용자 확인
2. 미정사항 3가지 확인
3. PHASE 1 시작
