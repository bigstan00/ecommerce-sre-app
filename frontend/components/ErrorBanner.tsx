export default function ErrorBanner({
  title = "Something went wrong",
  message,
}: {
  title?: string;
  message: string;
}) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm">{message}</p>
    </div>
  );
}
