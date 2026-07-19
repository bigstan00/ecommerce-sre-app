import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Storefront",
  description: "Practice e-commerce storefront frontend",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
          Storefront &middot; practice e-commerce SRE app
        </footer>
      </body>
    </html>
  );
}
