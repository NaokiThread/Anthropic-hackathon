export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold">ページが見つかりません</h1>
        <p className="text-gray-600">指定したURLは存在しないか、移動しました。</p>
        <a href="/" className="text-pink-600 underline">トップに戻る</a>
      </div>
    </main>
  );
}

