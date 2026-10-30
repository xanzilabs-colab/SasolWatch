import { NextResponse } from "next/server";

export const revalidate = 600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: true, message: "Valid latitude and longitude are required." }, { status: 400 });
  }

  const apiKey = process.env.OPEN_METEO_API_KEY;
  const baseUrl = apiKey
    ? "https://customer-api.open-meteo.com/v1/forecast"
    : "https://api.open-meteo.com/v1/forecast";
  const url = new URL(baseUrl);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,precipitation,pressure_msl,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timezone", "Africa/Johannesburg");
  if (apiKey) url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
    const result = await response.json();
    const current = result.current;
    if (!current) throw new Error("Open-Meteo response did not contain current conditions.");
    return NextResponse.json({
      source: "open-meteo",
      temperature_c: current.temperature_2m,
      humidity_pct: current.relative_humidity_2m,
      precipitation_mm: current.precipitation,
      pressure_hpa: current.pressure_msl,
      cloud_cover_pct: current.cloud_cover,
      wind_speed_ms: current.wind_speed_10m,
      wind_gust_ms: current.wind_gusts_10m,
      wind_dir_deg: current.wind_direction_10m,
      observed_at: current.time,
    }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("Open-Meteo request failed", error);
    return NextResponse.json({ error: true }, { status: 502 });
  }
}
