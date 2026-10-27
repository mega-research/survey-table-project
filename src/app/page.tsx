import { redirect } from 'next/navigation';

// 랜딩 페이지는 당분간 닫는다 — 루트로 들어오면 설문 목록으로 보낸다.
// 세션 쿠키가 없으면 미들웨어(proxy.ts)가 /login?redirect=/surveys 로 돌린다.
export default function Home() {
  redirect('/surveys');
}
