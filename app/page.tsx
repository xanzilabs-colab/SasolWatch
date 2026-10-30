import { Activity, ExternalLink, Radio } from "lucide-react";
import { Dashboard } from "@/components/Dashboard";
import { supabaseConfigured } from "@/lib/supabase";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  if (!supabaseConfigured) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="setup-brand"><Activity size={21} /> SASOL<span>SNIFF</span></div>
          <div className="setup-icon"><Radio size={24} /></div>
          <p className="eyebrow">DASHBOARD SETUP</p>
          <h1>Connect your monitoring node</h1>
          <p>Add your Supabase URL and anon key to <code>.env.local</code> to start the live dashboard.</p>
          <div className="setup-file"><span>.env.local</span><code>NEXT_PUBLIC_SUPABASE_URL=<br />NEXT_PUBLIC_SUPABASE_ANON_KEY=</code></div>
          <p className="setup-note">Use the project’s public anon key only. This dashboard never needs a login or service-role key.</p>
          <a href="https://supabase.com/dashboard/project/_/settings/api" target="_blank" rel="noreferrer">Find API settings <ExternalLink size={14} /></a>
        </div>
      </main>
    );
  }
  return <Dashboard initialDemoMode={params.demo === "1"} />;
}
