export default function Loading() {
  return (
    <div className="grid animate-pulse gap-8 md:grid-cols-2">
      <div className="aspect-square rounded-lg bg-slate-200" />
      <div className="flex flex-col gap-3">
        <div className="h-3 w-1/4 rounded bg-slate-200" />
        <div className="h-7 w-3/4 rounded bg-slate-200" />
        <div className="h-8 w-1/3 rounded bg-slate-200" />
        <div className="h-20 w-full rounded bg-slate-200" />
      </div>
    </div>
  );
}
