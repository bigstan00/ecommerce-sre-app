export default function Loading() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="card animate-pulse overflow-hidden">
          <div className="aspect-square w-full bg-slate-200" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-3 w-1/3 rounded bg-slate-200" />
            <div className="h-4 w-3/4 rounded bg-slate-200" />
            <div className="h-4 w-1/2 rounded bg-slate-200" />
          </div>
        </div>
      ))}
    </div>
  );
}
