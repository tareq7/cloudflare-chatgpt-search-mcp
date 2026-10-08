// Standards-based RSS parser (fast-xml-parser) and HTML snippet extraction (Cheerio).
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { load } from "cheerio/slim";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  trimValues: true,
});

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "object" && typeof value["#text"] === "string") return value["#text"];
  return "";
}

function plain(value) {
  const raw = textValue(value);
  if (!raw) return "";
  return load("<div>" + raw + "</div>").text().replace(/\s+/g, " ").trim();
}

export function parseSearchRss(xml, { source, limit = 10 }) {
  if (limit <= 0) return [];
  if (typeof xml !== "string" || xml.length > 1_500_000 || XMLValidator.validate(xml) !== true) {
    throw new Error("Invalid RSS XML feed.");
  }
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel;
  if (!channel || typeof channel !== "object") {
    throw new Error("Invalid RSS feed: missing channel.");
  }
  const rawItems = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];
  return rawItems.slice(0, limit).map((item) => {
    const publisher = item.source;
    return {
      title: plain(item.title),
      url: textValue(item.link).trim(),
      description: plain(item.description),
      published_at: plain(item.pubDate) || undefined,
      publisher: plain(publisher) || undefined,
      publisher_url: publisher && typeof publisher === "object"
        ? publisher["@_url"] || undefined
        : undefined,
      source,
    };
  }).filter(row => row.title && /^https?:\/\//i.test(row.url));
}
