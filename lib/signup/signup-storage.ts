/**
 * 가입 위저드 상태(signupRole/signupProfile/signupSelectedStores 등)는 이메일 인증
 * 링크가 새 탭에서 열려도 이어져야 한다. sessionStorage는 탭마다 완전히 격리되므로
 * 쓸 수 없다. 반면 localStorage는 같은 오리진의 모든 탭/창이 공유하고, 네트워크로
 * 전송되지 않아(쿠키·URL 파라미터와 달리 서버 로그나 Referrer로 새지 않음) 이메일/
 * 비밀번호 같은 값을 담기에도 더 안전하다. 이 객체를 `sessionStorage` 자리에 그대로
 * 끼워 넣을 수 있도록 동일한 getItem/setItem/removeItem 인터페이스로 감싼다.
 */
export const signupStorage = {
  getItem(key: string): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(key);
  },
};
