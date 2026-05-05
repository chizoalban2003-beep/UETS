// file-ingest — parse uploaded files (CSV, JSON, PDF, image) and store extracted context.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.4.168/build/pdf.min.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function detectKind(filename: string, mime: string): "csv" | "json" | "pdf" | "image" | "xlsx" | "unknown" {
  const ext = filename.toLowerCase().split(".").pop() || "";
  if (ext === "csv" || mime === "text/csv") return "csv";
  if (ext === "json" || mime === "application/json") return "json";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext) || mime.startsWith("image/")) return "image";
  if (["xlsx", "xls"].includes(ext)) return "xlsx";
  return "unknown";
}

async function aiSummarize(text: string, filename: string): Promise<string> {
  try {
    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "user",
            content: `Summarise this file in 3 concise bullet points for use as trading context. File: "${filename}".\n\n${text.slice(0, 4000)}`,
          },
        ],
        stream: false,
      }),
    });
    if (!resp.ok) return "";
    const j = await resp.json();
    return j?.choices?.[0]?.message?.content || "";
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return new Response(JSON.stringify({ error: "auth required" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user } } = await createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  ).auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "invalid jwt" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Parse multipart form or JSON
  let filename = "upload";
  let mimeType = "application/octet-stream";
  let bytes: Uint8Array;

  const ct = req.headers.get("content-type") || "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      return new Response(JSON.stringify({ error: "file field required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    filename = file.name;
    mimeType = file.type || mimeType;
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const body = await req.json().catch(() => ({}));
    const base64 = body?.base64 as string | undefined;
    filename = body?.filename || filename;
    mimeType = body?.mime_type || mimeType;
    if (!base64) {
      return new Response(JSON.stringify({ error: "base64 or multipart file required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const bin = atob(base64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  }

  const kind = detectKind(filename, mimeType);
  let extractedText = "";
  let rowCount: number | null = null;
  let pageCount = 1;

  // ── CSV ──────────────────────────────────────────────────────────────────
  if (kind === "csv") {
    const text = new TextDecoder().decode(bytes);
    const lines = text.split("\n").filter((l) => l.trim());
    rowCount = Math.max(0, lines.length - 1);
    const preview = lines.slice(0, 20).join("\n");
    extractedText = `CSV with ${rowCount} data rows.\n\nHeaders + preview:\n${preview}`;
  }

  // ── JSON ─────────────────────────────────────────────────────────────────
  else if (kind === "json") {
    const text = new TextDecoder().decode(bytes);
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) rowCount = parsed.length;
      extractedText = `JSON file. ${rowCount != null ? `Array of ${rowCount} items.` : "Object."}\n\nPreview:\n${text.slice(0, 2000)}`;
    } catch {
      extractedText = `JSON file (parse error). Raw:\n${text.slice(0, 2000)}`;
    }
  }

  // ── PDF ──────────────────────────────────────────────────────────────────
  else if (kind === "pdf") {
    try {
      const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
      const textParts: string[] = [];
      const pagesToRead = Math.min(pdf.numPages, 20); // cap at 20 pages
      for (let p = 1; p <= pagesToRead; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        textParts.push(content.items.map((i: any) => i.str).join(" "));
      }
      extractedText = textParts.join("\n\n").slice(0, 8000);
      pageCount = pdf.numPages; // reuse for page count
      rowCount = pdf.numPages;
    } catch (pdfErr) {
      extractedText = `[PDF parsing failed: ${pdfErr}]`;
    }
  }

  // ── Image ────────────────────────────────────────────────────────────────
  else if (kind === "image") {
    extractedText = `[Image file: ${filename}, ${bytes.length} bytes. Vision analysis not yet available.]`;
    pageCount = 1;
  }

  // ── XLSX ─────────────────────────────────────────────────────────────────
  else if (kind === "xlsx") {
    extractedText = `[XLSX file: ${filename}, ${bytes.length} bytes. Spreadsheet parsing not yet available.]`;
  }

  // ── Unknown ──────────────────────────────────────────────────────────────
  else {
    extractedText = `[Unsupported file type: ${mimeType}]`;
  }

  // Check file_pages_limit for this user
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("file_pages_limit")
    .eq("user_id", user.id)
    .maybeSingle();

  const pagesLimit = Number((sub as any)?.file_pages_limit ?? 0);
  if (pagesLimit === 0) {
    return new Response(
      JSON.stringify({ error: "file_upload_not_allowed", message: "File uploads require a paid plan. Upgrade in Billing." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Count pages already used this calendar month
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const { data: usedRows } = await supabase
    .from("ingested_files")
    .select("page_count")
    .eq("user_id", user.id)
    .gte("created_at", monthStart.toISOString());
  const pagesUsed = (usedRows || []).reduce((a, r: any) => a + (Number(r.page_count) || 1), 0);
  const pagesNeeded = pageCount;
  if (pagesUsed + pagesNeeded > pagesLimit) {
    return new Response(
      JSON.stringify({
        error: "file_pages_limit_exceeded",
        message: `You've used ${pagesUsed}/${pagesLimit} pages this month. Upgrade to get more.`,
      }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Generate AI summary
  const aiSummary = extractedText ? await aiSummarize(extractedText, filename) : "";

  // Persist to ingested_files
  const { data: record, error: insertErr } = await supabase
    .from("ingested_files")
    .insert({
      user_id: user.id,
      filename,
      mime_type: mimeType,
      size_bytes: bytes.length,
      page_count: pageCount,
      row_count: rowCount,
      extracted_text: extractedText,
      ai_summary: aiSummary,
    })
    .select()
    .single();

  if (insertErr) {
    return new Response(JSON.stringify({ error: insertErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      file_id: (record as any).id,
      kind,
      filename,
      page_count: pageCount,
      row_count: rowCount,
      ai_summary: aiSummary,
      extracted_text_preview: extractedText.slice(0, 500),
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
