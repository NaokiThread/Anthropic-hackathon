"use client";

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <main className="min-h-screen flex items-center justify-center p-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold">アプリで問題が発生しました</h1>
            <p className="text-gray-600 break-all">{error?.message || "不明なエラー"}</p>
            <button onClick={() => reset()} className="px-4 py-2 bg-pink-600 text-white rounded">再試行</button>
          </div>
        </main>
      </body>
    </html>
  );
}

