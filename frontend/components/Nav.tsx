import Link from "next/link";
import { isLoggedIn } from "@/lib/session";
import LogoutButton from "./LogoutButton";

export default function Nav() {
  const loggedIn = isLoggedIn();

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-600 text-white">
            S
          </span>
          Storefront
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          <Link href="/" className="font-medium text-slate-600 hover:text-slate-900">
            Home
          </Link>
          <Link href="/cart" className="font-medium text-slate-600 hover:text-slate-900">
            Cart
          </Link>
          {loggedIn ? (
            <LogoutButton />
          ) : (
            <>
              <Link href="/login" className="font-medium text-slate-600 hover:text-slate-900">
                Log in
              </Link>
              <Link href="/register" className="btn-primary !px-3 !py-1.5">
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
