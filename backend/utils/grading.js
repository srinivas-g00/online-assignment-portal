// backend/utils/grading.js

const fs = require("fs");
const path = require("path");
const { gradeWithAI } = require("./aiGrading");

// Dynamic loader for Google GenAI SDK (falls back to native fetch if package is absent)
let GoogleGenAIClass = null;
try {
  GoogleGenAIClass = require("@google/genai").GoogleGenAI;
} catch (e) {
  // @google/genai not installed
}

let GoogleGenerativeAIClass = null;
try {
  GoogleGenerativeAIClass = require("@google/generative-ai").GoogleGenerativeAI;
} catch (e) {
  // @google/generative-ai not installed
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/*
 * ============================================================
 * MIME TYPE RESOLVER (Supports filename, MIME string & magic bytes)
 * ============================================================
 */
function resolveMimeType(originalNameOrMime = "", buffer = null) {
  const str = String(originalNameOrMime || "").toLowerCase().trim();

  // If already a valid MIME type
  if (str === "application/pdf" || str.includes("/pdf")) return "application/pdf";
  if (str === "image/jpeg" || str === "image/jpg") return "image/jpeg";
  if (str === "image/png") return "image/png";
  if (str === "image/webp") return "image/webp";
  if (str === "image/bmp") return "image/bmp";
  if (str === "image/gif") return "image/gif";
  if (str === "image/tiff" || str === "image/tif") return "image/tiff";

  // Check file extension
  const ext = path.extname(str).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";

  // Check buffer magic bytes
  if (Buffer.isBuffer(buffer) && buffer.length >= 4) {
    // PDF magic bytes: %PDF (0x25 0x50 0x44 0x46)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      return "application/pdf";
    }
    // JPEG magic bytes: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }
    // PNG magic bytes: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return "image/png";
    }
    // WEBP magic bytes: RIFF....WEBP
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "image/webp";
    }
    // BMP magic bytes: BM (0x42 0x4D)
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return "image/bmp";
    }
  }

  return "application/octet-stream";
}

/*
 * ============================================================
 * COMMON GEMINI VISION CALLER (Multi-SDK & REST Fallback)
 * ============================================================
 */
async function callGeminiVisionAPI({ apiKey, model, buffer, mimeType, prompt }) {
  const base64 = buffer.toString("base64");

  // 1. Try @google/genai SDK
  if (GoogleGenAIClass) {
    try {
      const ai = new GoogleGenAIClass({ apiKey });
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        config: {
          temperature: 0.1,
        },
      });

      const text = response?.text ? String(response.text).trim() : "";
      if (text) return text;
    } catch (err) {
      console.warn(`[@google/genai] Vision call failed for ${model}: ${err.message}`);
      if (!err.message || !err.message.includes("404")) throw err;
    }
  }

  // 2. Try @google/generative-ai SDK
  if (GoogleGenerativeAIClass) {
    try {
      const genAI = new GoogleGenerativeAIClass(apiKey);
      const generativeModel = genAI.getGenerativeModel({ model });
      const result = await generativeModel.generateContent([
        prompt,
        {
          inlineData: {
            data: base64,
            mimeType,
          },
        },
      ]);
      const response = await result.response;
      const text = response.text() ? response.text().trim() : "";
      if (text) return text;
    } catch (err) {
      console.warn(`[@google/generative-ai] Vision call failed for ${model}: ${err.message}`);
      if (!err.message || !err.message.includes("404")) throw err;
    }
  }

  // 3. Fallback to native fetch REST API (Zero dependency)
  const candidateModels = [
    model,
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-2.5-flash",
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  for (const candidate of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[Gemini REST] Model ${candidate} returned ${res.status}: ${errorText.slice(0, 160)}`);
        continue;
      }

      const data = await res.json();
      const candidateText =
        data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (candidateText && candidateText.trim()) {
        return candidateText.trim();
      }
    } catch (fetchErr) {
      console.warn(`[Gemini REST] Request error for ${candidate}: ${fetchErr.message}`);
    }
  }

  return "";
}

/*
 * ============================================================
 * COMMON GEMINI OCR FUNCTION
 * ============================================================
 */
async function runGeminiOCR(buffer, mimeType, originalName = "") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !buffer || !buffer.length) {
    console.warn("[OCR] Missing API key or buffer for OCR.");
    return "";
  }

  const model =
    process.env.GEMINI_VISION_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";

  const prompt = `
You are an expert academic OCR and handwriting transcription engine.

You are evaluating a student's handwritten academic assignment submission.
Carefully inspect and transcribe ALL pages, answers, and content visible in this document.

The document contains:
- Student handwriting (cursive, print, notes, pencil, or pen)
- Mathematical equations, fractions, square roots, formulas, calculations
- Numerical problem steps and final values
- Hexadecimal/binary notation (e.g., 4000H, 14000H, 0x1F)
- Programming source code, syntax, logic
- SQL queries, table schemas, queries, conditions
- Diagrams, block labels, tables, charts, flowcharts
- Multiple numbered or unnumbered questions

YOUR INSTRUCTIONS:
1. Accurately transcribe all readable student handwritten and typed answers.
2. DO NOT grade, judge, solve, or correct the student's work.
3. Transcribe exactly what the student wrote, even if their answer is incomplete or mathematically incorrect.
4. Preserve all question numbers (e.g., Question 1, Q2, Problem 3).
5. If question numbers are not explicitly written, separate answers cleanly.
6. For math/numerical steps, transcribe intermediate calculations and final answers verbatim.
7. For programming code or SQL, preserve formatting, variable names, keywords, and operators (+, -, *, /, =, <, >).
8. If a specific word, symbol, or equation is genuinely unreadable, output [UNCLEAR].
9. Never invent answers or hallucinate missing sections.
10. Do not mention student personal identity or AI speculation.

FORMAT YOUR OUTPUT AS:
QUESTION 1:
[Transcribed student answer]

QUESTION 2:
[Transcribed student answer]

Continue for every question. If no question numbers are found, format as:
QUESTION:
[Transcribed student answer]

Return ONLY the transcribed plain text student submission.
`;

  console.log(`[OCR] Sending ${originalName || mimeType} (${(buffer.length / 1024 / 1024).toFixed(2)} MB) to Gemini Vision...`);

  try {
    const extracted = await callGeminiVisionAPI({
      apiKey,
      model,
      buffer,
      mimeType,
      prompt,
    });

    console.log(`[OCR] OCR transcription returned ${extracted.length} characters.`);
    return extracted || "";
  } catch (error) {
    console.error("[OCR] Gemini OCR request failed:", error?.message || error);
    return "";
  }
}

/*
 * ============================================================
 * BUFFER-BASED GEMINI VISION OCR
 * Used when submission file is stored in memory (Buffer)
 * ============================================================
 */
async function visionExtractBuffer(buffer, originalNameOrMime = "", secondaryName = "") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    console.warn("[OCR] Empty buffer or missing Gemini API key.");
    return "";
  }

  // Resolve MIME type using name, MIME string, or magic bytes
  let mimeType = resolveMimeType(originalNameOrMime, buffer);
  if (mimeType === "application/octet-stream" && secondaryName) {
    mimeType = resolveMimeType(secondaryName, buffer);
  }

  console.log(`[OCR] Starting Gemini Vision OCR for buffer. Resolved MIME: ${mimeType}`);

  if (mimeType === "application/octet-stream") {
    console.warn(`[OCR] Could not determine file type for: ${originalNameOrMime}`);
    return "";
  }

  if (mimeType === "application/pdf" && buffer.length > 50 * 1024 * 1024) {
    console.error("[OCR] PDF is larger than 50 MB limit for inline OCR.");
    return "";
  }

  const extractedText = await runGeminiOCR(
    buffer,
    mimeType,
    originalNameOrMime
  );

  console.log(`[OCR] Final extracted text length: ${extractedText.length}`);
  return extractedText;
}

/*
 * ============================================================
 * FILE PATH-BASED GEMINI VISION OCR
 * ============================================================
 */
async function visionExtract(filePath, originalName = "") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !filePath || !fs.existsSync(filePath)) {
    console.warn("[OCR] Missing API key or file does not exist:", filePath);
    return "";
  }

  try {
    const buffer = fs.readFileSync(filePath);
    const identifier = originalName || filePath;
    return await visionExtractBuffer(buffer, identifier);
  } catch (error) {
    console.error("[OCR] VISION OCR ERROR:", error?.message || error);
    return "";
  }
}

/*
 * ============================================================
 * NORMAL TEXT EXTRACTION (Selectable PDF, DOCX, TXT)
 * ============================================================
 */
async function normalExtract(filePath, originalName = "") {
  const ext = path.extname(originalName || filePath).toLowerCase();

  try {
    if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");
      const buf = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return data.text || "";
    }

    if (ext === ".docx") {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value || "";
    }

    if (ext === ".txt") {
      return fs.readFileSync(filePath, "utf8");
    }

    return "";
  } catch (error) {
    console.warn("[OCR] NORMAL EXTRACTION ERROR:", error?.message || error);
    return "";
  }
}

/*
 * ============================================================
 * SMART EXTRACTION (Routes scanned/handwritten documents to Vision)
 * ============================================================
 */
async function extractText(filePath, originalName = "") {
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn("[OCR] File path does not exist:", filePath);
    return "";
  }

  const ext = path.extname(originalName || filePath).toLowerCase();

  // Images are handwritten/scanned documents -> Always Gemini Vision
  if ([".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tiff", ".tif"].includes(ext)) {
    console.log(`[OCR] Image detected: ${originalName || filePath}`);
    return await visionExtract(filePath, originalName);
  }

  // PDFs: try text parse first; if handwritten/scanned (low selectable text), use Vision OCR
  if (ext === ".pdf") {
    console.log(`[OCR] PDF detected: ${originalName || filePath}`);
    const normalText = await normalExtract(filePath, originalName);

    if (normalText && normalText.trim().length >= 100) {
      console.log(`[OCR] Selectable PDF text found (${normalText.length} chars). Using normal extraction.`);
      return normalText.trim();
    }

    console.log("[OCR] PDF contains little/no selectable text. Sending to Gemini Vision OCR...");
    const visionText = await visionExtract(filePath, originalName);
    if (visionText && visionText.trim()) {
      return visionText.trim();
    }

    return normalText?.trim() || "";
  }

  // Word doc / Text
  return await normalExtract(filePath, originalName);
}

/*
 * ============================================================
 * NORMALIZATION & OCR DUPLICATE DETECTION
 * ============================================================
 */

// Filter out common question prompts/boilerplates so they don't artificially inflate similarity
const BOILERPLATE_WORDS = new Set([
  "question", "answer", "answers", "total", "marks", "university",
  "assignment", "roll", "registration", "student", "page", "section", "part"
]);

function normalize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !BOILERPLATE_WORDS.has(word));
}

/**
 * Creates 2-word shingles (bigrams) for accurate duplication detection across OCR text.
 */
function createBigrams(words) {
  const shingles = new Set();
  for (let i = 0; i < words.length - 1; i++) {
    shingles.add(`${words[i]} ${words[i + 1]}`);
  }
  return shingles;
}

/**
 * Multi-level similarity calculation for OCR texts (combines word tokens & bigram shingles).
 * Returns percentage from 0 to 100.
 */
function calculateSimilarity(textA, textB) {
  const wordsA = normalize(textA);
  const wordsB = normalize(textB);

  if (!wordsA.length || !wordsB.length) return 0;

  // 1. Single-word Jaccard
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let wordIntersect = 0;
  for (const w of setA) {
    if (setB.has(w)) wordIntersect++;
  }
  const wordUnion = setA.size + setB.size - wordIntersect;
  const wordSim = wordUnion ? wordIntersect / wordUnion : 0;

  // 2. Bigram Jaccard (catches copied phrases and sentences despite slight OCR typos)
  const bigramsA = createBigrams(wordsA);
  const bigramsB = createBigrams(wordsB);

  let bigramSim = 0;
  if (bigramsA.size && bigramsB.size) {
    let bigramIntersect = 0;
    for (const bg of bigramsA) {
      if (bigramsB.has(bg)) bigramIntersect++;
    }
    const bigramUnion = bigramsA.size + bigramsB.size - bigramIntersect;
    bigramSim = bigramUnion ? bigramIntersect / bigramUnion : 0;
  }

  // Weighted score: 65% sequence overlap (bigrams), 35% vocabulary overlap
  const composite = (bigramSim * 0.65) + (wordSim * 0.35);
  return Math.round(composite * 100);
}

/**
 * Legacy Jaccard similarity (0 to 1).
 */
function similarity(textA, textB) {
  return calculateSimilarity(textA, textB) / 100;
}

/**
 * External plagiarism API hook or local fallback.
 */
async function externalSimilarity(textA, textB) {
  const url = process.env.PLAGIARISM_API_URL;
  const key = process.env.PLAGIARISM_API_KEY;

  if (!url || !key) {
    return similarity(textA, textB);
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ textA, textB }),
    });

    const data = await res.json();
    if (typeof data.similarity === "number") {
      return Math.max(0, Math.min(1, data.similarity));
    }
  } catch (error) {
    console.warn("[DUPLICATE] External similarity API failed, using local metric:", error?.message || error);
  }

  return similarity(textA, textB);
}

/*
 * ============================================================
 * KEYWORD OVERLAP SCORE (Fallback if AI grading fails)
 * ============================================================
 */
function scoreAgainstKey(submissionText, answerKey, totalMarks = 100) {
  const keyTerms = [...new Set(normalize(answerKey))];
  if (!keyTerms.length) return 0;

  const subTerms = new Set(normalize(submissionText));
  const matched = keyTerms.filter((term) => subTerms.has(term)).length;
  const ratio = matched / keyTerms.length;

  return Math.max(0, Math.min(totalMarks, Math.round(ratio * totalMarks)));
}

/*
 * ============================================================
 * AUTO CORRECTION WORKFLOW (OCR -> Duplicate Detection -> AI Grading)
 * ============================================================
 */
async function autoCorrectAssignment(
  submissions,
  answerKey,
  totalMarks = 100,
  assignmentTitle = "Assignment"
) {
  const texts = {};

  // 1. OCR EVERY SUBMISSION
  for (const submission of submissions) {
    const filePath = submission.file_path || submission.file_url;
    const originalName = submission.file_original || submission.original_filename || "";

    console.log(`[AUTO CORRECT] Extracting submission ${submission.id} (${originalName})...`);

    if (filePath && typeof filePath === "string" && fs.existsSync(filePath)) {
      texts[submission.id] = await extractText(filePath, originalName);
    } else {
      texts[submission.id] = "";
    }
  }

  const results = [];

  // 2. GRADE AND CHECK DUPLICATES
  for (let i = 0; i < submissions.length; i++) {
    const submission = submissions[i];
    const text = texts[submission.id] || "";
    const needsReview = text.trim().length < 20;

    let autoMarks = 0;
    let feedback = "";
    let gradedBy = "none";

    if (!needsReview) {
      if (i > 0) await sleep(1500);

      const aiResult = await gradeWithAI(
        assignmentTitle,
        answerKey,
        text,
        totalMarks
      );

      if (aiResult) {
        autoMarks = Number(aiResult.marks) || 0;
        feedback = aiResult.feedback || "Automated grading completed.";
        gradedBy = "ai";
      } else {
        autoMarks = scoreAgainstKey(text, answerKey, totalMarks);
        feedback = "AI grading was unavailable. Keyword-based fallback scoring was used.";
        gradedBy = "keyword";
      }
    } else {
      feedback = "No readable student answer was extracted from the handwritten document. Manual review required.";
      gradedBy = "manual_review";
    }

    // DUPLICATE DETECTION ACROSS OCR SUBMISSIONS
    let maxSim = 0;
    for (const other of submissions) {
      if (other.id === submission.id) continue;
      const otherText = texts[other.id] || "";
      if (!text.trim() || !otherText.trim()) continue;

      const simPct = calculateSimilarity(text, otherText);
      const sim = simPct / 100;
      if (sim > maxSim) maxSim = sim;
    }

    const similarityPct = Math.round(maxSim * 100);
    const duplicateFlag = similarityPct >= 70 ? 1 : 0;

    results.push({
      id: submission.id,
      autoMarks,
      feedback,
      gradedBy,
      similarityPct,
      duplicateFlag,
      needsReview,
    });
  }

  return results;
}

/*
 * ============================================================
 * EXPORTS
 * ============================================================
 */
module.exports = {
  extractText,
  visionExtract,
  visionExtractBuffer,
  normalExtract,
  resolveMimeType,
  scoreAgainstKey,
  similarity,
  calculateSimilarity,
  externalSimilarity,
  autoCorrectAssignment,
};