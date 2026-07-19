"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function CategoryFilter({
  categories,
  selected,
}: {
  categories: string[];
  selected?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function selectCategory(category: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (category) {
      params.set("category", category);
    } else {
      params.delete("category");
    }
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => selectCategory("")}
        className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
          !selected
            ? "bg-brand-600 text-white"
            : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-100"
        }`}
      >
        All
      </button>
      {categories.map((category) => (
        <button
          key={category}
          onClick={() => selectCategory(category)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
            selected === category
              ? "bg-brand-600 text-white"
              : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-100"
          }`}
        >
          {category}
        </button>
      ))}
    </div>
  );
}
