This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Supabase email confirmation

Supabase Dashboard의 **Authentication > URL Configuration**에서 다음을 확인합니다.

- **Site URL**: 현재 실행 중인 앱의 origin만 지정합니다. 로컬은
	`http://localhost:3000`, 운영은 `https://<production-domain>` 형식이며 가입 페이지
	경로를 붙이지 않습니다.
- **Redirect URLs**: 각 환경의 콜백 URL을 등록합니다.

```text
http://localhost:3000/auth/callback
https://<production-domain>/auth/callback
```

**Authentication > Email Templates > Confirm signup**의 인증 버튼 링크는 반드시
`{{ .ConfirmationURL }}`을 사용해야 합니다. `{{ .RedirectTo }}`를 버튼에 직접 사용하면
Supabase의 확인 엔드포인트를 건너뛰므로 PKCE `code`가 발급되지 않습니다. 설정 변경 전에
발송된 이메일에는 이전 링크가 남아 있으므로 변경 후 새 인증 이메일로 확인해야 합니다.

새 이메일의 버튼 링크는 클릭 전에 주소를 복사해 확인할 수 있습니다. 정상 링크는 먼저
`https://<project-ref>.supabase.co/auth/v1/verify?...`를 가리키고, 그 안의
`redirect_to` 값이 URL 인코딩된 `/auth/callback?next=...`이어야 합니다. 링크가 처음부터
`/signup/approval` 또는 `/signup/stores`를 가리키면 이메일 템플릿이나 Redirect URL 설정이
잘못된 것입니다. 브라우저 개발자 도구에서는 가입 직전에 출력되는
`[AUTH_SIGNUP][profile] emailRedirectTo` 또는 `[AUTH_SIGNUP][approval] emailRedirectTo`
로그로 SDK에 전달된 실제 값을 확인할 수 있습니다.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
