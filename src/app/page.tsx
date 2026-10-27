import { redirect } from 'next/navigation';

// 랜딩 페이지는 당분간 닫는다 — 루트로 들어오면 관리자 설문 목록으로 보낸다.
// 로그인이 안 되어 있으면 미들웨어(proxy.ts)가 /admin/login?redirect=/admin/surveys 로 돌린다.
export default function Home() {
  redirect('/admin/surveys');
}
