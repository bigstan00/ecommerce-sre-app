import Link from "next/link";

export default function Pagination({
  page,
  limit,
  total,
  buildHref,
}: {
  page: number;
  limit: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (totalPages <= 1) {
    return null;
  }

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <nav className="mt-8 flex items-center justify-center gap-4" aria-label="Pagination">
      <Link
        href={buildHref(page - 1)}
        aria-disabled={prevDisabled}
        className={`btn-secondary ${prevDisabled ? "pointer-events-none opacity-40" : ""}`}
      >
        Previous
      </Link>
      <span className="text-sm text-slate-600">
        Page {page} of {totalPages}
      </span>
      <Link
        href={buildHref(page + 1)}
        aria-disabled={nextDisabled}
        className={`btn-secondary ${nextDisabled ? "pointer-events-none opacity-40" : ""}`}
      >
        Next
      </Link>
    </nav>
  );
}
