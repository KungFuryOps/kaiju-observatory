const USER_AGENT = "KaijuObservatory/0.2 (+https://github.com/KungFuryOps/kaiju-observatory)";

export interface SourceLocation {
  origin: string;
  path: string;
}

function normalizeSourceLocation(originValue: string, pathValue: string): SourceLocation {
  const origin = new URL(originValue);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/") {
    throw new Error("The configured source origin must be an HTTPS origin without credentials or a path");
  }

  const path = pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
  const sourceUrl = new URL(path, origin);
  if (sourceUrl.origin !== origin.origin) {
    throw new Error("The configured source path must remain on the configured origin");
  }

  return { origin: origin.origin, path: `${sourceUrl.pathname}${sourceUrl.search}` };
}

export function sourceLocationFromEnv(): SourceLocation {
  const origin = process.env.KAIJU_SOURCE_ORIGIN;
  const path = process.env.KAIJU_SOURCE_PATH;
  if (!origin || !path) {
    throw new Error("The configured source is unavailable");
  }
  return normalizeSourceLocation(origin, path);
}

async function decodeResponse(response: Response, label: string): Promise<string> {
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new TextDecoder("iso-8859-1").decode(buffer);
}

export async function fetchSourcePage(location: SourceLocation): Promise<string> {
  const response = await fetch(`${location.origin}${location.path}`, {
    headers: { "user-agent": USER_AGENT },
  });
  return decodeResponse(response, "Source request");
}

export async function fetchLinkedPage(location: SourceLocation, href: string): Promise<string> {
  const url = new URL(href, `${location.origin}/`);
  if (url.origin !== location.origin) {
    throw new Error("Refusing to follow a link outside the configured origin");
  }

  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
  });
  return decodeResponse(response, "Linked source request");
}

export async function postSourceForm(
  location: SourceLocation,
  form: Record<string, string>,
): Promise<string> {
  const response = await fetch(`${location.origin}${location.path}`, {
    method: "POST",
    headers: {
      "user-agent": USER_AGENT,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
  });
  return decodeResponse(response, "Source form request");
}
