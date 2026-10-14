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

## Naver Maps: Desktop and Mobile

- Set `NEXT_PUBLIC_NAVER_MAP_KEY_ID` to the public key ID for the NCP Maps application. The existing `NEXT_PUBLIC_NAVER_MAP_CLIENT_ID` name remains supported as a fallback; both names use the current `ncpKeyId` SDK parameter. Do not put the secret key in either variable.
- Enable **Web Dynamic Map** for that application in the NCP console. Use a key issued for the current Maps product, not a key from an unrelated service or the legacy Maps product.
- Under **Application > API settings > Web Service URL**, register the actual URLs used to open the app, including the scheme and any development port where required by the console. Desktop `http://localhost:3000` registration does not authorize a phone opening `http://192.168.0.153:3000`. Register your current LAN address, HTTPS deployment URL, or ngrok URL separately; update the registration when that address changes.
- The phone and development machine must be on a reachable network. Open the app using the computer's LAN address, not `localhost` on the phone. Do not use wildcard origins to bypass authentication.
- `NEXT_PUBLIC_` variables are embedded by `next build`. Set the key in the build environment, restart `next dev` after changing local env files, and rebuild/redeploy after changing a production key. Runtime env changes cannot repair a bundle built without the key.
- The SDK is always loaded over HTTPS. A script HTTP 200/onload does not prove successful authentication: the component also handles `navermap_authFailure`, missing SDK constructors, network errors, and loading timeouts. Retry reloads a failed script; an unauthorized URL or incorrect key still needs to be corrected in NCP.
- If the browser reports an authentication failure, check the application/key pairing, Web Dynamic Map activation, the registered URL against the address bar, and whether the failed network request sends that same site as its Referer. Ensure your proxy does not strip Referer or block the HTTPS Maps SDK and tile requests.
