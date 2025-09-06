"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-bold">エラーが発生しました</h1>
        <p className="text-gray-600 break-all">{error?.message || "不明なエラー"}</p>
        {error?.digest && <p className="text-xs text-gray-400">digest: {error.digest}</p>}
        <div className="space-x-3">
          <button onClick={() => reset()} className="px-4 py-2 bg-pink-600 text-white rounded">再読み込み</button>
          <a href="/" className="px-4 py-2 border rounded">トップへ</a>
        </div>
      </div>
    </main>
  );
}

