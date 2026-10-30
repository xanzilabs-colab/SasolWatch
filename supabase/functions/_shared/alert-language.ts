const COMPASS_NAMES: Record<string, string> = {
  N: "north",
  NNE: "north-northeast",
  NE: "northeast",
  ENE: "east-northeast",
  E: "east",
  ESE: "east-southeast",
  SE: "southeast",
  SSE: "south-southeast",
  S: "south",
  SSW: "south-southwest",
  SW: "southwest",
  WSW: "west-southwest",
  W: "west",
  WNW: "west-northwest",
  NW: "northwest",
  NNW: "north-northwest",
};

export function buildPlainAirAlert(severity: string, windFrom: string): string {
  const direction = COMPASS_NAMES[windFrom.toUpperCase()] ?? "an unknown direction";
  const advice = severity === "severe"
    ? "Please stay indoors if you can, close your windows and doors, and follow advice from local officials."
    : severity === "high"
      ? "Please stay indoors if you can. Close windows and doors, and keep children, older people, and anyone with breathing problems inside."
      : "Please spend less time outside and close windows facing the wind.";

  return [
    "Air warning for your area.",
    "The air monitor has noticed a big change in its reading.",
    advice,
    `The wind is coming from the ${direction}.`,
    "This is a precaution. The monitor cannot tell us exactly what is in the air or where it came from.",
  ].join(" ");
}

export async function translateAlertToSesotho(message: string, apiKey: string): Promise<string> {
  if (!apiKey.trim()) throw new Error("GEMI_API_KEY is not configured");

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: "Translate the supplied air-safety alert into natural, everyday Sesotho (Southern Sotho) used in South Africa. Keep it short and easy to understand. Preserve the meaning and every safety instruction. Do not add facts, advice, headings, English, or commentary. Return only the Sesotho message.",
          }],
        },
        contents: [{ parts: [{ text: message }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
      }),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error(`Gemini translation failed (HTTP ${response.status})`);

  const result: unknown = await response.json();
  if (!result || typeof result !== "object") throw new Error("Gemini returned an invalid translation response");
  const candidates = (result as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: unknown }> };
    }>;
  }).candidates;
  const candidate = candidates?.[0];
  if (candidate?.finishReason === "MAX_TOKENS") throw new Error("Gemini translation was truncated");
  const translation = candidate?.content?.parts
    ?.map((part) => typeof part.text === "string" ? part.text : "")
    .join("")
    .trim();
  if (!translation || translation.length > 1200) throw new Error("Gemini returned an empty or oversized translation");
  return translation;
}
