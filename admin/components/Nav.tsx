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
            A
          </span>
          Admin
        </Link>

        {loggedIn && (
          <nav className="flex items-center gap-5 text-sm">
            <Link href="/" className="font-medium text-slate-600 hover:text-slate-900">
              Dashboard
            </Link>
            <Link href="/products" className="font-medium text-slate-600 hover:text-slate-900">
              Products
            </Link>
            <Link href="/inventory" className="font-medium text-slate-600 hover:text-slate-900">
              Inventory
            </Link>
            <Link href="/orders" className="font-medium text-slate-600 hover:text-slate-900">
              Orders
            </Link>
            <LogoutButton />
          </nav>
        )}
      </div>
    </header>
  );
}
