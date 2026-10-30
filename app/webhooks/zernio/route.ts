import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forwardHeaders = [
  "content-type",
  "x-zernio-signature",
  "x-zernio-event-id",
  "x-zernio-event",
] as const;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  if (!supabaseUrl) return Response.json({ error: "Webhook forwarding is not configured" }, { status: 503 });

  const headers = new Headers();
  for (const name of forwardHeaders) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const upstream = await fetch(
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/zernio-webhook`,
      {
        method: "POST",
        headers,
        body: await request.arrayBuffer(),
        cache: "no-store",
        signal: AbortSignal.timeout(4300),
      },
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "Webhook forwarding failed" }, { status: 504 });
  }
}
