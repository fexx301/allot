export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-10 w-2/3 max-w-xl rounded-xl" />
      <div className="skeleton h-4 w-1/2 max-w-md rounded-lg" />
      <div className="skeleton mt-6 h-64 w-full rounded-3xl" />
    </div>
  );
}
