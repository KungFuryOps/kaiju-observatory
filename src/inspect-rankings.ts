import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  fetchLinkedPage,
  fetchSourcePage,
  postSourceForm,
  sourceLocationFromEnv,
} from "./fetch-rankings.js";

interface InspectOptions {
  profile: string;
  followEntry: boolean;
}

interface TableSchema {
  requiredHeaders: string[];
  entryHeader: string;
  emptyEntryText?: string;
}

interface SourceSchema {
  profiles: Record<string, Record<string, string>>;
  table: TableSchema;
}

interface RankingEntrySummary {
  rows: number;
  nameWordCounts: {
    one: number;
    two: number;
    three: number;
    fourOrMore: number;
  };
  duplicateNormalizedNames: number;
  cellsWithLinks: number;
  cellsWithOnclick: number;
  hrefShapes: string[];
  onclickShapes: string[];
  descendantTags: string[];
  attributeNames: string[];
}

const SYNTHETIC_TABLE_SCHEMA: TableSchema = {
  requiredHeaders: ["Rank", "Participant", "Score"],
  entryHeader: "Participant",
  emptyEntryText: "no participants",
};
const SYNTHETIC_ORIGIN = "https://source.invalid";

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function booleanArg(name: string, fallback = false): boolean {
  const value = arg(name);
  if (value == null || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function valueShape(value: string): string {
  if (!value) return "[EMPTY]";
  if (/^\d+$/.test(value)) return "[NUMBER]";
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(value)) return "[DATE]";
  return "[TEXT]";
}

function scriptShape(value: string): string {
  return /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(/.test(value)
    ? "[CALL]([REDACTED])"
    : "[REDACTED_SCRIPT]";
}

function pathShape(pathname: string): string {
  const segments = pathname.split("/");
  return segments
    .map((segment) => {
      if (!segment) return "";
      return /^\d+$/.test(segment) ? "[NUMBER]" : "[SEGMENT]";
    })
    .join("/");
}

export function hrefShape(href: string, sourceOrigin = SYNTHETIC_ORIGIN): string {
  if (/^javascript:/i.test(href)) {
    return `javascript:${scriptShape(href)}`;
  }

  try {
    const base = new URL(sourceOrigin);
    const url = new URL(href, `${base.origin}/`);
    if (url.origin !== base.origin) return "[EXTERNAL_URL]";
    const query = Array.from(url.searchParams.values())
      .map((value, index) => `p${index + 1}=${valueShape(value)}`)
      .join("&");
    return `${pathShape(url.pathname)}${query ? `?${query}` : ""}${url.hash ? "#[FRAGMENT]" : ""}`;
  } catch {
    return "[INVALID_URL]";
  }
}

function isFollowableSourceHref(href: string, sourceOrigin: string): boolean {
  if (!href || href === "#" || /^javascript:/i.test(href)) return false;
  try {
    return new URL(href, `${sourceOrigin}/`).origin === sourceOrigin;
  } catch {
    return false;
  }
}

function shapeCounts(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const shape = valueShape(value);
    counts[shape] = (counts[shape] ?? 0) + 1;
  }
  return counts;
}

function formSummaries($: cheerio.CheerioAPI, sourceOrigin: string): Array<{
  index: number;
  method: string;
  actionShape: string;
  inputs: Array<{ type: string; valueShape: string; maxLength: number | null }>;
  selects: Array<{ optionCount: number; selectedCount: number; valueShapes: Record<string, number> }>;
}> {
  return $("form")
    .toArray()
    .map((form, index) => ({
      index,
      method: ($(form).attr("method") ?? "GET").toUpperCase(),
      actionShape: hrefShape($(form).attr("action") ?? "", sourceOrigin),
      inputs: $(form).find("input")
        .toArray()
        .map((input) => {
          const maxLength = Number($(input).attr("maxlength"));
          return {
            type: $(input).attr("type") ?? "text",
            valueShape: valueShape($(input).attr("value") ?? ""),
            maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : null,
          };
        }),
      selects: $(form).find("select")
        .toArray()
        .map((select) => {
          const options = $(select).find("option").toArray();
          return {
            optionCount: options.length,
            selectedCount: options.filter((option) => $(option).is("[selected]")).length,
            valueShapes: shapeCounts(options.map((option) => $(option).attr("value") ?? "")),
          };
        }),
    }));
}

function tableSummaries($: cheerio.CheerioAPI, sourceOrigin: string): Array<{
  index: number;
  headers: string[];
  rows: number;
  sampleCellShapes: Array<Array<{
    textLength: number;
    links: number;
    hasDate: boolean;
    hrefShapes: string[];
  }>>;
}> {
  return $("table")
    .toArray()
    .map((table, index) => {
      const rows = $(table).find("tr").toArray();
      return {
        index,
        headers: $(rows[0]).find("td, th").toArray()
          .map((cell) => clean($(cell).text()) ? "[HEADER]" : ""),
        rows: rows.length,
        sampleCellShapes: rows.slice(1, 6).map((row) => (
          $(row).find("td, th").toArray().map((cell) => {
            const text = clean($(cell).text());
            const anchors = $(cell).find("a").toArray();
            return {
              textLength: text.length,
              links: anchors.length,
              hasDate: /(?<!\d)\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?!\d)/.test(text),
              hrefShapes: Array.from(new Set(
                anchors.map((anchor) => hrefShape($(anchor).attr("href") ?? "", sourceOrigin)),
              )),
            };
          })
        )),
      };
    })
    .filter((table) => table.headers.length > 0 || table.sampleCellShapes.length > 0);
}

function linkSummaries(
  $: cheerio.CheerioAPI,
  sourceOrigin: string,
): Array<{ hrefShape: string; hasText: boolean; count: number }> {
  const counts = new Map<string, { hrefShape: string; hasText: boolean; count: number }>();
  $("a[href]").each((_, anchor) => {
    const shape = hrefShape($(anchor).attr("href") ?? "", sourceOrigin);
    const hasText = Boolean(clean($(anchor).text()));
    const key = `${shape}|${hasText}`;
    const previous = counts.get(key);
    counts.set(key, { hrefShape: shape, hasText, count: (previous?.count ?? 0) + 1 });
  });
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count || a.hrefShape.localeCompare(b.hrefShape))
    .slice(0, 40);
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeRankingEntries(
  html: string,
  tableSchema: TableSchema = SYNTHETIC_TABLE_SCHEMA,
  sourceOrigin = SYNTHETIC_ORIGIN,
): {
  summary: RankingEntrySummary | null;
  firstFollowableHref: string | null;
} {
  const $ = cheerio.load(html);
  const table = $("table").toArray().find((candidate) => {
    const headers = $(candidate).find("tr").first().find("td, th").toArray()
      .map((cell) => clean($(cell).text()));
    return tableSchema.requiredHeaders.every((header) => headers.includes(header));
  });
  if (!table) return { summary: null, firstFollowableHref: null };

  const headers = $(table).find("tr").first().find("td, th").toArray()
    .map((cell) => clean($(cell).text()));
  const entryIndex = headers.indexOf(tableSchema.entryHeader);
  if (entryIndex < 0) return { summary: null, firstFollowableHref: null };

  const names = new Map<string, number>();
  const hrefShapes = new Set<string>();
  const onclickShapes = new Set<string>();
  const descendantTags = new Set<string>();
  const attributeNames = new Set<string>();
  const nameWordCounts = { one: 0, two: 0, three: 0, fourOrMore: 0 };
  const emptyEntryText = normalizedName(tableSchema.emptyEntryText ?? "");
  let rows = 0;
  let cellsWithLinks = 0;
  let cellsWithOnclick = 0;
  let firstFollowableHref: string | null = null;

  for (const row of $(table).find("tr").slice(1).toArray()) {
    const cells = $(row).find("td, th").toArray();
    const cell = cells[entryIndex];
    if (!cell) continue;
    const entryName = clean($(cell).text());
    if (!entryName || (emptyEntryText && normalizedName(entryName).includes(emptyEntryText))) continue;
    rows++;

    const words = entryName.split(/\s+/).filter(Boolean).length;
    if (words <= 1) nameWordCounts.one++;
    else if (words === 2) nameWordCounts.two++;
    else if (words === 3) nameWordCounts.three++;
    else nameWordCounts.fourOrMore++;

    const normalized = normalizedName(entryName);
    names.set(normalized, (names.get(normalized) ?? 0) + 1);

    const elements = [cell, ...$(cell).find("*").toArray()];
    for (const element of elements) {
      descendantTags.add(element.tagName.toLowerCase());
      for (const attributeName of Object.keys(element.attribs ?? {})) attributeNames.add(attributeName);
      const onclick = $(element).attr("onclick");
      if (onclick) onclickShapes.add(scriptShape(onclick));
    }

    const anchors = $(cell).find("a").toArray();
    if (anchors.length > 0) cellsWithLinks++;
    if ($(cell).is("[onclick]") || $(cell).find("[onclick]").length > 0) cellsWithOnclick++;
    for (const anchor of anchors) {
      const href = $(anchor).attr("href") ?? "";
      if (href) hrefShapes.add(hrefShape(href, sourceOrigin));
      if (!firstFollowableHref && isFollowableSourceHref(href, sourceOrigin)) {
        firstFollowableHref = href;
      }
    }
  }

  return {
    summary: {
      rows,
      nameWordCounts,
      duplicateNormalizedNames: Array.from(names.values()).filter((count) => count > 1).length,
      cellsWithLinks,
      cellsWithOnclick,
      hrefShapes: Array.from(hrefShapes),
      onclickShapes: Array.from(onclickShapes),
      descendantTags: Array.from(descendantTags).sort(),
      attributeNames: Array.from(attributeNames).sort(),
    },
    firstFollowableHref,
  };
}

export function summarizeEntryDetail(html: string, sourceOrigin = SYNTHETIC_ORIGIN): {
  titleLength: number;
  yearsMentioned: number[];
  dateOccurrences: number;
  forms: ReturnType<typeof formSummaries>;
  tables: ReturnType<typeof tableSummaries>;
  hrefShapes: Array<{ hrefShape: string; count: number }>;
} {
  const $ = cheerio.load(html);
  const bodyText = clean($("body").text());
  const yearsMentioned = Array.from(new Set(
    Array.from(bodyText.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)).map((match) => Number(match[1])),
  )).sort((a, b) => a - b);
  const dateOccurrences = Array.from(
    bodyText.matchAll(/(?<!\d)\d{1,2}[/-]\d{1,2}[/-]\d{2,4}(?!\d)/g),
  ).length;
  const hrefCounts = new Map<string, number>();
  $("a[href]").each((_, anchor) => {
    const shape = hrefShape($(anchor).attr("href") ?? "", sourceOrigin);
    hrefCounts.set(shape, (hrefCounts.get(shape) ?? 0) + 1);
  });

  return {
    titleLength: clean($("title").text()).length,
    yearsMentioned,
    dateOccurrences,
    forms: formSummaries($, sourceOrigin),
    tables: tableSummaries($, sourceOrigin),
    hrefShapes: Array.from(hrefCounts.entries())
      .map(([hrefShapeValue, count]) => ({ hrefShape: hrefShapeValue, count }))
      .sort((a, b) => b.count - a.count || a.hrefShape.localeCompare(b.hrefShape)),
  };
}

function sourceSchemaFromEnv(): SourceSchema {
  const raw = process.env.KAIJU_SOURCE_SCHEMA;
  if (!raw) throw new Error("The configured source schema is unavailable");

  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new Error("The configured source schema is invalid");
  }

  if (!candidate || typeof candidate !== "object") {
    throw new Error("The configured source schema is invalid");
  }
  const schema = candidate as Partial<SourceSchema>;
  if (!schema.profiles || typeof schema.profiles !== "object" || !schema.table) {
    throw new Error("The configured source schema is incomplete");
  }
  if (!Array.isArray(schema.table.requiredHeaders)
    || !schema.table.requiredHeaders.every((value) => typeof value === "string" && value)
    || typeof schema.table.entryHeader !== "string"
    || !schema.table.entryHeader) {
    throw new Error("The configured table schema is invalid");
  }

  return schema as SourceSchema;
}

function profileForm(schema: SourceSchema, profile: string): Record<string, string> {
  const candidate = schema.profiles[profile];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("The selected inspection profile is unavailable");
  }
  const entries = Object.entries(candidate);
  if (entries.length === 0 || entries.length > 20) {
    throw new Error("The selected inspection profile is invalid");
  }
  for (const [key, value] of entries) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || typeof value !== "string" || value.length > 256) {
      throw new Error("The selected inspection profile is invalid");
    }
  }
  return Object.fromEntries(entries);
}

async function main(): Promise<void> {
  const options: InspectOptions = {
    profile: arg("profile", "landing") ?? "landing",
    followEntry: booleanArg("follow-entry"),
  };
  if (!/^[a-z0-9-]{1,32}$/.test(options.profile)) {
    throw new Error("The inspection profile name is invalid");
  }

  const location = sourceLocationFromEnv();
  const schema = sourceSchemaFromEnv();
  const method = options.profile === "landing" ? "GET" : "POST";
  const form = method === "POST" ? profileForm(schema, options.profile) : {};

  console.log("Inspecting configured ranking source");
  console.log("request:", JSON.stringify({
    method,
    profile: options.profile,
    formFieldCount: Object.keys(form).length,
    followEntry: options.followEntry,
  }, null, 2));

  const html = method === "POST"
    ? await postSourceForm(location, form)
    : await fetchSourcePage(location);
  const $ = cheerio.load(html);

  console.log("page:", JSON.stringify({ titleLength: clean($("title").text()).length }, null, 2));
  console.log("forms:", JSON.stringify(formSummaries($, location.origin), null, 2));
  console.log("tables:", JSON.stringify(tableSummaries($, location.origin), null, 2));
  console.log("links:", JSON.stringify(linkSummaries($, location.origin), null, 2));
  const rankingEntries = summarizeRankingEntries(html, schema.table, location.origin);
  console.log("rankingEntries:", JSON.stringify(rankingEntries.summary, null, 2));

  if (options.followEntry) {
    if (!rankingEntries.firstFollowableHref) {
      console.log("entryDetail:", JSON.stringify({ status: "no-direct-entry-link" }, null, 2));
    } else {
      const entryHtml = await fetchLinkedPage(location, rankingEntries.firstFollowableHref);
      console.log("entryDetail:", JSON.stringify({
        status: "fetched",
        sourceHrefShape: hrefShape(rankingEntries.firstFollowableHref, location.origin),
        ...summarizeEntryDetail(entryHtml, location.origin),
      }, null, 2));
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
