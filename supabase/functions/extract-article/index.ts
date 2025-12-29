// Supabase Edge Function: extract-article
// - URLをfetchしてReadabilityで本文抽出し、articles.content_json/content_text等を更新する
//
// Deploy例:
//   supabase functions deploy extract-article
//
// Invoke例（クライアント）:
//   supabase.functions.invoke('extract-article', { body: { articleId, url } })

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Readability } from "npm:@mozilla/readability@0.5.0";
import { JSDOM } from "npm:jsdom@26.0.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function isBlockedHost(hostname: string) {
  const h = hostname.toLowerCase();
  if (h === "localhost") return true;
  if (h.endsWith(".localhost")) return true;
  // 直接IP指定（ざっくり）
  if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h)) return true;
  if (h === "0.0.0.0") return true;
  if (h === "169.254.169.254") return true; // metadata
  return false;
}

async function fetchWithLimits(url: string) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Web-to-Book-Reader/0.1 (+https://example.invalid) Readability extractor",
        "accept": "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

    // サイズ上限（Content-Lengthがないサイトもあるため、読みながら制限）
    const maxBytes = 3 * 1024 * 1024;
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no response body");

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) throw new Error("response too large");
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder().decode(merged);
  } finally {
    clearTimeout(t);
  }
}

function toNodes(doc: Document) {
  // MVP: p/h1/h2/h3/img/blockQuoteの最低限だけ正規化
  const nodes: Array<Record<string, unknown>> = [];
  const root = doc.body;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);

  function pushText(tag: string, text: string) {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    nodes.push({ t: tag, text: t });
  }

  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "p" || tag === "blockquote") pushText(tag, el.textContent ?? "");
    if (tag === "h1" || tag === "h2" || tag === "h3") pushText(tag, el.textContent ?? "");
    if (tag === "img") {
      const src = el.getAttribute("src") ?? "";
      if (src) nodes.push({ t: "img", src, alt: el.getAttribute("alt") ?? "" });
    }
  }

  return nodes;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    const auth = req.headers.get("authorization");
    if (!auth) return new Response("Unauthorized", { status: 401 });

    const { url, articleId } = await req.json();
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid scheme");
    if (isBlockedHost(parsed.hostname)) throw new Error("blocked host");

    // JWTからuser_idを特定（RLSを迂回せず、所有者紐付けのために使う）
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { authorization: auth } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return new Response("Unauthorized", { status: 401 });
    const userId = userData.user.id;

    // 記事行を特定（方式A: 事前作成 or 方式B: ここで作成）
    let targetId = articleId as string | undefined;
    if (!targetId) {
      const ins = await supabaseAdmin
        .from("articles")
        .insert({ user_id: userId, url, status: "unread", extract_status: "fetching" })
        .select("id")
        .single();
      if (ins.error) throw ins.error;
      targetId = ins.data.id;
    } else {
      await supabaseAdmin
        .from("articles")
        .update({ extract_status: "fetching", extract_error: null })
        .eq("id", targetId)
        .eq("user_id", userId);
    }

    const html = await fetchWithLimits(url);
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const result = reader.parse();
    if (!result?.textContent) throw new Error("readability returned empty content");

    const contentDoc = new JSDOM(result.content ?? "", { url }).window.document;
    const nodes = toNodes(contentDoc);

    const contentJson = {
      title: result.title ?? null,
      byline: result.byline ?? null,
      siteName: result.siteName ?? null,
      lang: result.lang ?? null,
      excerpt: result.excerpt ?? null,
      nodes,
    };

    const contentText = result.textContent.trim();

    const up = await supabaseAdmin
      .from("articles")
      .update({
        title: result.title ?? null,
        site_name: result.siteName ?? null,
        author: result.byline ?? null,
        excerpt: result.excerpt ?? null,
        lang: result.lang ?? null,
        content_json: contentJson,
        content_text: contentText,
        extract_status: "succeeded",
        extract_error: null,
      })
      .eq("id", targetId)
      .eq("user_id", userId)
      .select("id,extract_status,title,site_name")
      .single();

    if (up.error) throw up.error;

    return new Response(JSON.stringify({ articleId: up.data.id, extractStatus: up.data.extract_status }), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
});

