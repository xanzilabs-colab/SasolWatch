import { NextResponse } from "next/server";

export const revalidate = 600;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json({ error: true, message: "Valid latitude and longitude are required." }, { status: 400 });
  }

  const apiKey = process.env.OPENWEATHER_API_KEY?.trim() || process.env.OPEN_METEO_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: true, message: "OpenWeather is not configured. Set OPENWEATHER_API_KEY on the server." }, { status: 503 });
  }
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", apiKey);

  try {
    const response = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`OpenWeather returned ${response.status}`);
    const result = await response.json();
    if (!result.main || !result.wind) throw new Error("OpenWeather response did not contain current conditions.");
    const precipitation = result.rain?.["1h"] ?? result.rain?.["3h"] ?? 0;
    return NextResponse.json({
      source: "openweather",
      temperature_c: result.main.temp,
      humidity_pct: result.main.humidity,
      precipitation_mm: precipitation,
      pressure_hpa: result.main.pressure,
      cloud_cover_pct: result.clouds?.all ?? null,
      wind_speed_ms: result.wind.speed,
      wind_gust_ms: result.wind.gust ?? null,
      wind_dir_deg: result.wind.deg ?? null,
      observed_at: result.dt ? new Date(result.dt * 1000).toISOString() : null,
    }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=300" } });
  } catch (error) {
    console.error("OpenWeather request failed", error instanceof Error ? error.name : "Unknown error");
    return NextResponse.json({ error: true, message: "OpenWeather could not provide current conditions." }, { status: 502 });
  }
}
