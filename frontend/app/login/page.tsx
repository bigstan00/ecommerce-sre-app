import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6">
      <h1 className="text-center text-2xl font-bold text-slate-900">Log in</h1>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
