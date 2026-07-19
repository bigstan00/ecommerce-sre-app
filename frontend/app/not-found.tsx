import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <h1 className="text-3xl font-bold text-slate-900">Page not found</h1>
      <p className="text-slate-500">The thing you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/" className="btn-primary mt-2">
        Back to shopping
      </Link>
    </div>
  );
}
