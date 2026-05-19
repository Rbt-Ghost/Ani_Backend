import http from "node:http";
import { createHash, createDecipheriv } from "node:crypto";

const PORT = Number(process.env.PORT ?? 3001);
const ALLANIME_BASE = process.env.ALLANIME_BASE ?? "allanime.day";
const ALLANIME_API = process.env.ALLANIME_API ?? `https://api.${ALLANIME_BASE}`;
const ALLANIME_REFERER = process.env.ALLANIME_REFERER ?? "https://allmanga.to";
const USER_AGENT = process.env.USER_AGENT ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0";
const ALLANIME_KEY = createHash("sha256").update("Xot36i3lK3:v1").digest();

const ANI_CLI_BYTE_MAP = new Map([
  ["79", "A"], ["7a", "B"], ["7b", "C"], ["7c", "D"], ["7d", "E"], ["7e", "F"], ["7f", "G"],
  ["70", "H"], ["71", "I"], ["72", "J"], ["73", "K"], ["74", "L"], ["75", "M"], ["76", "N"], ["77", "O"],
  ["68", "P"], ["69", "Q"], ["6a", "R"], ["6b", "S"], ["6c", "T"], ["6d", "U"], ["6e", "V"], ["6f", "W"],
  ["60", "X"], ["61", "Y"], ["62", "Z"], ["59", "a"], ["5a", "b"], ["5b", "c"], ["5c", "d"], ["5d", "e"],
  ["5e", "f"], ["5f", "g"], ["50", "h"], ["51", "i"], ["52", "j"], ["53", "k"], ["54", "l"], ["55", "m"],
  ["56", "n"], ["57", "o"], ["48", "p"], ["49", "q"], ["4a", "r"], ["4b", "s"], ["4c", "t"], ["4d", "u"],
  ["4e", "v"], ["4f", "w"], ["40", "x"], ["41", "y"], ["42", "z"], ["08", "0"], ["09", "1"], ["0a", "2"],
  ["0b", "3"], ["0c", "4"], ["0d", "5"], ["0e", "6"], ["0f", "7"], ["00", "8"], ["01", "9"], ["15", "-"],
  ["16", "."], ["67", "_"], ["46", "~"], ["02", ":"], ["17", "/"], ["07", "?"], ["1b", "#"], ["63", "["],
  ["65", "]"], ["78", "@"], ["19", "!"], ["1c", "$"], ["1e", "&"], ["10", "("], ["11", ")"], ["12", "*"],
  ["13", "+"], ["14", ","], ["03", ";"], ["05", "="], ["1d", "%"],
]);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function buildHeaders(extraHeaders = {}) {
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: ALLANIME_REFERER,
    Referer: ALLANIME_REFERER,
    "User-Agent": USER_AGENT,
    ...extraHeaders,
  };
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${text || response.statusText}`);
  }
  return text;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

function hexDecode(value) {
  const normalized = value.replace(/[^0-9a-f]/gi, "").toLowerCase();
  if (!normalized || normalized.length % 2 !== 0) return value;

  const bytes = normalized.match(/.{2}/g) ?? [];
  const decoded = bytes
    .map((byte) => ANI_CLI_BYTE_MAP.get(byte) ?? String.fromCharCode(Number.parseInt(byte, 16)))
    .join("");

  return decoded.replace(/\/clock$/, "/clock.json");
}

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padding), "base64");
}

function decodeTobeparsed(blob) {
  const raw = decodeBase64Url(blob);
  if (raw.length <= 29) return [];

  const iv = raw.subarray(1, 13);
  const cipherText = raw.subarray(13, raw.length - 16);
  const decipher = createDecipheriv("aes-256-ctr", ALLANIME_KEY, Buffer.concat([iv, Buffer.from("00000002", "hex")]));
  const plain = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");

  try {
    const parsed = JSON.parse(plain);
    const sourceUrls = parsed?.episode?.sourceUrls ?? parsed?.sourceUrls ?? [];
    if (Array.isArray(sourceUrls) && sourceUrls.length > 0) {
      return sourceUrls;
    }
  } catch {
    // Fall back to the legacy regex path below.
  }

  return plain
    .split(/[{}]/)
    .map((part) => part.match(/"sourceUrl":"--([^"]*)".*"sourceName":"([^"]*)"/))
    .filter(Boolean)
    .map((match) => ({
      url: match[1],
      name: match[2],
    }));
}

function normalizeEpisodeValue(value) {
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    if (typeof value.number === "string" || typeof value.number === "number") return String(value.number).trim();
    if (typeof value.episode === "string" || typeof value.episode === "number") return String(value.episode).trim();
  }
  return "";
}

async function searchAnime(query, mode) {
  const searchQuery = `query( $search: SearchInput $limit: Int $page: Int $translationType: VaildTranslationTypeEnumType $countryOrigin: VaildCountryOriginEnumType ) { shows( search: $search limit: $limit page: $page translationType: $translationType countryOrigin: $countryOrigin ) { edges { _id name availableEpisodes __typename } }}`;
  const payload = {
    variables: {
      search: { allowAdult: false, allowUnknown: false, query },
      limit: 40,
      page: 1,
      translationType: mode,
      countryOrigin: "ALL",
    },
    query: searchQuery,
  };

  const json = await fetchJson(`${ALLANIME_API}/api`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });

  const edges = json?.data?.shows?.edges ?? [];
  return edges
    .map((edge) => ({
      id: edge?._id ? String(edge._id) : "",
      title: edge?.name ? String(edge.name) : "Untitled anime",
      episodes: Number(edge?.availableEpisodes?.[mode] ?? edge?.availableEpisodes?.sub ?? edge?.availableEpisodes?.dub ?? 0) || null,
      image: edge?.thumbnail ?? edge?.image ?? null,
    }))
    .filter((item) => item.id);
}

async function getEpisodes(showId, mode) {
  const episodesQuery = `query ($showId: String!) { show( _id: $showId ) { _id availableEpisodesDetail }}`;
  const payload = {
    variables: { showId },
    query: episodesQuery,
  };

  const json = await fetchJson(`${ALLANIME_API}/api`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });

  const rawEpisodes = json?.data?.show?.availableEpisodesDetail?.[mode] ?? [];
  return rawEpisodes
    .map(normalizeEpisodeValue)
    .filter(Boolean)
    .sort((left, right) => Number(left) - Number(right))
    .map((number) => ({ number, label: `Episode ${number}` }));
}

function parseDirectSources(text) {
  const lines = text.replace(/\r/g, "\n").split(/\n+/);
  const sources = [];

  for (const line of lines) {
    const urlMatch = line.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/i);
    if (urlMatch) {
      const labelMatch = line.match(/([0-9]{3,4})p/i);
      sources.push({
        label: labelMatch?.[1] ? `${labelMatch[1]}p` : `Source ${sources.length + 1}`,
        url: urlMatch[1],
        kind: urlMatch[1].includes(".m3u8") ? "hls" : "mp4",
      });
    }
  }

  return sources;
}

function parseM3u8Playlist(text) {
  const sources = [];
  const blocks = text.split(/#EXT-X-STREAM-INF:/g).slice(1);

  for (const block of blocks) {
    const [metaLine, ...rest] = block.split(/\n/);
    const uri = rest.map((line) => line.trim()).find(Boolean);
    if (!uri) continue;

    const qualityMatch = metaLine?.match(/RESOLUTION=\d+x(\d+)/i) ?? metaLine?.match(/NAME="?([^",]+)"?/i);
    const label = qualityMatch?.[1] ? `${qualityMatch[1]}p` : `Variant ${sources.length + 1}`;
    sources.push({ label, url: uri.trim(), kind: "hls" });
  }

  return sources;
}

function parseFilemoonSources(text) {
  const compact = text.replace(/\n/g, " ").replace(/\s+/g, " ");
  const iv = compact.match(/"iv":"([^"]+)"/i)?.[1];
  const payload = compact.match(/"payload":"([^"]+)"/i)?.[1];
  const kp1 = compact.match(/"key_parts":\["([^"]+)"/i)?.[1];
  const kp2 = compact.match(/"([A-Za-z0-9_-]+)"\]/i)?.[1];

  if (!iv || !payload || !kp1 || !kp2) return [];

  const keyHex = Buffer.concat([decodeBase64Url(kp1), decodeBase64Url(kp2)]).toString("hex");
  const ivHex = `${decodeBase64Url(iv).toString("hex")}00000002`;
  const cipher = decodeBase64Url(payload);
  const decipher = createDecipheriv("aes-256-ctr", Buffer.from(keyHex, "hex"), Buffer.from(ivHex, "hex"));
  const plain = Buffer.concat([decipher.update(cipher.subarray(0, Math.max(0, cipher.length - 16))), decipher.final()]).toString("utf8");

  return plain
    .split(/[{}\[\]]/)
    .map((part) => part.match(/"(?:url|file)":"([^"]+)".*"height":([0-9]+)/i) ?? part.match(/"height":([0-9]+).*"(?:url|file)":"([^"]+)"/i))
    .filter(Boolean)
    .map((match) => {
      const height = match[2] ?? match[1];
      const url = match[1] ?? match[2];
      return {
        label: `${height}p`,
        url: url.replace(/\\u0026/g, "&").replace(/\\u003D/g, "="),
        kind: "hls",
      };
    });
}

function normalizeYouTubeIframe(url) {
  const match = url.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([^?&#/]+)/i);
  if (!match) return url;
  return `https://www.youtube-nocookie.com/embed/${match[1]}?autoplay=1&rel=0`;
}

async function resolveSource(sourceRecord) {
  if (typeof sourceRecord === "string") {
    const [sourceName = "Source", rawUrl = ""] = sourceRecord.split(/\s*:\s*/);
    sourceRecord = { name: sourceName, sourceUrl: rawUrl };
  }

  const sourceName = String(sourceRecord?.name ?? sourceRecord?.sourceName ?? "Source");
  const rawUrl = String(sourceRecord?.url ?? sourceRecord?.sourceUrl ?? "");
  if (!rawUrl) return [];

  if (String(sourceRecord?.type ?? "").toLowerCase() === "iframe") {
    return [{ label: sourceName, url: rawUrl, kind: "iframe" }];
  }

  const decodedUrl = hexDecode(rawUrl.includes(":") ? rawUrl.split(":").slice(1).join(":") : rawUrl);
  const absoluteUrl = decodedUrl.startsWith("http") ? decodedUrl : new URL(decodedUrl, `https://${ALLANIME_BASE}`).toString();

  if (/youtube/i.test(sourceName) || /youtube\.com|youtu\.be/i.test(absoluteUrl)) {
    return [{ label: sourceName, url: normalizeYouTubeIframe(absoluteUrl), kind: "iframe" }];
  }

  if (/\.(mp4|m3u8)(\?|$)/i.test(absoluteUrl)) {
    return [{ label: sourceName, url: absoluteUrl, kind: absoluteUrl.includes(".m3u8") ? "hls" : "mp4" }];
  }

  const response = await fetchText(absoluteUrl, {
    headers: {
      ...buildHeaders({ Referer: ALLANIME_REFERER }),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (/filemoon/i.test(absoluteUrl) || /"payload":"/.test(response)) {
    const filemoon = parseFilemoonSources(response);
    if (filemoon.length > 0) return filemoon;
  }

  if (/master\.m3u8/i.test(response) || /#EXTM3U/i.test(response)) {
    const masterMatch = response.match(/https?:\/\/[^"'\s]+master\.m3u8[^"'\s]*/i);
    const playlistUrl = masterMatch?.[0] ?? absoluteUrl;
    const playlist = await fetchText(playlistUrl, {
      headers: {
        ...buildHeaders({ Referer: ALLANIME_REFERER }),
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,*/*",
      },
    });
    const variants = parseM3u8Playlist(playlist);
    if (variants.length > 0) return variants;

    return [{ label: sourceName, url: playlistUrl, kind: "hls" }];
  }

  const directSources = parseDirectSources(response);
  if (directSources.length > 0) return directSources;

  const fallbackMatch = response.match(/https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*/i);
  if (fallbackMatch?.[0]) {
    return [{ label: sourceName, url: fallbackMatch[0], kind: fallbackMatch[0].includes(".m3u8") ? "hls" : "mp4" }];
  }

  return [{ label: sourceName, url: absoluteUrl, kind: "link" }];
}

async function getStreamDetails(showId, episode, mode) {
  const query = `query ($showId: String!, $translationType: VaildTranslationTypeEnumType!, $episodeString: String!) { episode( showId: $showId translationType: $translationType episodeString: $episodeString ) { episodeString sourceUrls } }`;
  const variables = { showId, translationType: mode, episodeString: episode };
  const extensions = { persistedQuery: { version: 1, sha256Hash: "d405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec" } };

  const queryUrl = new URL(`${ALLANIME_API}/api`);
  queryUrl.searchParams.set("variables", JSON.stringify(variables));
  queryUrl.searchParams.set("extensions", JSON.stringify(extensions));

  const firstResponse = await fetchText(queryUrl.toString(), {
    headers: {
      ...buildHeaders({ Origin: "https://youtu-chan.com", Referer: "https://youtu-chan.com" }),
      Accept: "application/json, text/plain, */*",
    },
  });

  let episodePayload = null;
  try {
    episodePayload = JSON.parse(firstResponse);
  } catch {
    episodePayload = null;
  }

  const episodeData = episodePayload?.data?.episode ?? {};
  const tobeparsed = episodePayload?.data?.tobeparsed ?? episodeData.tobeparsed ?? null;
  const sourceRecords = tobeparsed ? decodeTobeparsed(tobeparsed) : episodeData.sourceUrls ?? [];

  const resolvedSources = [];
  for (const sourceRecord of sourceRecords) {
    try {
      const sources = await resolveSource(sourceRecord);
      for (const source of sources) {
        if (!resolvedSources.some((item) => item.url === source.url)) {
          resolvedSources.push(source);
        }
      }
    } catch {
      // Ignore individual provider failures and keep the rest.
    }
  }

  return {
    id: showId,
    episode,
    mode,
    sources: resolvedSources,
    subtitles: [],
  };
}

async function handleRequest(req, res) {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "ani-cli-backend" });
    return;
  }

  if (requestUrl.pathname === "/api/search") {
    const query = requestUrl.searchParams.get("q")?.trim() ?? "";
    const mode = requestUrl.searchParams.get("mode") === "dub" ? "dub" : "sub";

    if (!query) {
      sendJson(res, 400, { error: "Missing query." });
      return;
    }

    try {
      const results = await searchAnime(query, mode);
      sendJson(res, 200, { results });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Search failed." });
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/episodes/")) {
    const showId = decodeURIComponent(requestUrl.pathname.replace("/api/episodes/", ""));
    const mode = requestUrl.searchParams.get("mode") === "dub" ? "dub" : "sub";

    if (!showId) {
      sendJson(res, 400, { error: "Missing show ID." });
      return;
    }

    try {
      const episodes = await getEpisodes(showId, mode);
      sendJson(res, 200, { episodes });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Episode lookup failed." });
    }
    return;
  }

  if (requestUrl.pathname.startsWith("/api/stream/")) {
    const segments = requestUrl.pathname.replace("/api/stream/", "").split("/").map((part) => decodeURIComponent(part));
    const [showId, episode] = segments;
    const mode = requestUrl.searchParams.get("mode") === "dub" ? "dub" : "sub";

    if (!showId || !episode) {
      sendJson(res, 400, { error: "Missing show ID or episode." });
      return;
    }

    try {
      const data = await getStreamDetails(showId, episode, mode);
      sendJson(res, 200, data);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Stream resolution failed." });
    }
    return;
  }

  if (requestUrl.pathname === "/") {
    sendText(
      res,
      200,
      [
        "ani-cli backend",
        "",
        "GET /api/health",
        "GET /api/search?q=...&mode=sub|dub",
        "GET /api/episodes/:id?mode=sub|dub",
        "GET /api/stream/:id/:episode?mode=sub|dub",
      ].join("\n")
    );
    return;
  }

  sendJson(res, 404, { error: "Not found." });
}

export { handleRequest };

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    sendJson(res, 500, { error: error instanceof Error ? error.message : "Unexpected server error." });
  });
});

if (!process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`ani-cli backend listening on http://localhost:${PORT}`);
  });
}