import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="fc-shell p-8 max-w-3xl mx-auto">
      <div className="fc-screenhead mb-8">
        <div className="fc-screenhead-main">
          <Link href="/" className="fc-btn fc-btn-ghost mb-4 w-max">← Back to FloatChat</Link>
          <span className="fc-kicker">Legal</span>
          <h1 className="fc-screen-title">Privacy Policy</h1>
        </div>
      </div>
      <div className="fc-panel p-6 prose prose-invert">
        <p>This is a placeholder for the FloatChat privacy policy.</p>
        <p>Your session data and chat history are kept securely.</p>
      </div>
    </div>
  );
}
