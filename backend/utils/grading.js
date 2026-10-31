
// backend/utils/grading.js

const fs = require("fs");
const path = require("path");
const { gradeWithAI } = require("./aiGrading");

let GoogleGenAIClass = null;
try {
  GoogleGenAIClass = require("@google/genai").GoogleGenAI;
} catch (e) {
  // Native fetch fallback will be used.
}

let GoogleGenerativeAIClass = null;
try {
  GoogleGenerativeAIClass =
    require("@google/generative-ai").GoogleGenerativeAI;
} catch (e) {
  // Native fetch fallback will be used.
}

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const IMAGE_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".webp",
  ".bmp", ".tiff", ".tif",
];

const BOILERPLATE_WORDS = new Set([
  "question", "answer", "answers", "total", "marks",
  "university", "assignment", "roll", "registration",
  "student", "page", "section", "part",
]);

// ============================================================
// OCR CONFIGURATION
// ============================================================

function getOCRMode() {
  const configured = String(
    process.env.OCR_MODE || "auto"
  ).toLowerCase();

  if (configured !== "auto") return configured;

  // Never assume a Windows/local Ollama server is accessible
  // from the Render production environment.
  return process.env.NODE_ENV === "production"
    ? "gemini"
    : "local-first";
}

function isGeminiFallbackEnabled() {
  const value = process.env.OCR_GEMINI_FALLBACK;

  if (value === undefined) return true;

  return !["false", "0", "no", "off"].includes(
    String(value).toLowerCase()
  );
}

function getLocalOCRUrl() {
  return (
    process.env.LOCAL_OCR_URL ||
    "http://127.0.0.1:11434/api/chat"
  );
}

function getLocalOCRModel() {
  return (
    process.env.LOCAL_OCR_MODEL ||
    "llama3.2-vision"
  );
}

// ============================================================
// MIME TYPE RESOLVER
// ============================================================

function resolveMimeType(
  originalNameOrMime = "",
  buffer = null
) {
  const str = String(originalNameOrMime || "")
    .toLowerCase()
    .trim();

  if (str === "application/pdf" || str.includes("/pdf")) {
    return "application/pdf";
  }

  if (str === "image/jpeg" || str === "image/jpg") {
    return "image/jpeg";
  }

  if (str === "image/png") return "image/png";
  if (str === "image/webp") return "image/webp";
  if (str === "image/bmp") return "image/bmp";
  if (str === "image/gif") return "image/gif";

  if (str === "image/tiff" || str === "image/tif") {
    return "image/tiff";
  }

  const ext = path.extname(str).toLowerCase();

  if (ext === ".pdf") return "application/pdf";

  if ([".jpg", ".jpeg"].includes(ext)) {
    return "image/jpeg";
  }

  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".gif") return "image/gif";

  if ([".tif", ".tiff"].includes(ext)) {
    return "image/tiff";
  }

  if (Buffer.isBuffer(buffer) && buffer.length >= 4) {
    if (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    ) {
      return "application/pdf";
    }

    if (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    ) {
      return "image/jpeg";
    }

    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return "image/png";
    }

    if (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
      return "image/webp";
    }

    if (
      buffer[0] === 0x42 &&
      buffer[1] === 0x4d
    ) {
      return "image/bmp";
    }
  }

  return "application/octet-stream";
}

// ============================================================
// COMMON ACADEMIC OCR PROMPT
// ============================================================

const OCR_PROMPT = `
You are an expert academic OCR and handwriting transcription engine.

Carefully inspect and transcribe ALL readable content in the
student's handwritten academic assignment.

The document may contain:
- Cursive and printed handwriting.
- Pencil and pen writing.
- Mathematical equations, fractions and formulas.
- Numerical calculations and intermediate steps.
- Hexadecimal and binary notation.
- Programming source code and SQL queries.
- Tables, diagrams, charts and flowcharts.
- Multiple numbered and unnumbered questions.

INSTRUCTIONS:

1. Transcribe exactly what the student wrote.
2. Do not grade, judge, solve or correct the work.
3. Preserve question numbers and answer order.
4. Preserve mathematical symbols, numbers and equations.
5. Preserve programming variable names, operators and syntax.
6. Do not silently correct spelling or mathematical mistakes.
7. Mark genuinely unreadable content as [UNCLEAR].
8. Never invent missing answers.
9. Do not omit readable intermediate working steps.
10. Preserve paragraph and answer structure.
11. Do not describe the image.
12. Do not include comments about OCR accuracy.

OUTPUT FORMAT:

QUESTION 1:
[Transcribed answer]

QUESTION 2:
[Transcribed answer]

Continue for every question.

If question numbers are not visible, use:
QUESTION:
[Transcribed answer]

Return ONLY the transcribed student answer.
`;

// ============================================================
// LOCAL LLAMA VISION OCR - OLLAMA
// ============================================================

async function runLocalLlamaOCR(
  buffer,
  mimeType,
  originalName = ""
) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return "";
  }

  // Ollama Vision accepts image inputs, not raw PDF documents.
  if (!mimeType.startsWith("image/")) {
    console.log(
      "[LOCAL OCR] Skipping unsupported local document type:",
      mimeType
    );

    return "";
  }

  const model = getLocalOCRModel();
  const url = getLocalOCRUrl();

  const timeoutMs = Math.max(
    5000,
    Number(process.env.LOCAL_OCR_TIMEOUT_MS) || 120000
  );

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    console.log(
      `[LOCAL OCR] Sending ${originalName || mimeType} to ${model}...`
    );

    const payload = {
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: OCR_PROMPT,
          images: [
            buffer.toString("base64"),
          ],
        },
      ],
      options: {
        temperature: 0,
      },
    };

    const headers = {
      "Content-Type": "application/json",
    };

    if (process.env.LOCAL_OCR_API_KEY) {
      headers.Authorization =
        `Bearer ${process.env.LOCAL_OCR_API_KEY}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Ollama returned ${response.status}: ${errorText.slice(0, 300)}`
      );
    }

    const data = await response.json();

    const extracted = String(
      data?.message?.content ||
      data?.response ||
      ""
    ).trim();

    if (!extracted) {
      console.warn(
        "[LOCAL OCR] Llama returned an empty transcription."
      );

      return "";
    }

    console.log(
      `[LOCAL OCR] Successfully extracted ${extracted.length} characters.`
    );

    return extracted;
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(
        `[LOCAL OCR] Request timed out after ${timeoutMs} ms.`
      );
    } else {
      console.error(
        "[LOCAL OCR] Failed:",
        error.message
      );
    }

    return "";
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// GEMINI VISION API CALLER
// SDK + REST FALLBACK
// ============================================================

async function callGeminiVisionAPI({
  apiKey,
  model,
  buffer,
  mimeType,
  prompt,
}) {
  const base64 = buffer.toString("base64");

  // 1. Google GenAI SDK
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

      const text = response?.text
        ? String(response.text).trim()
        : "";

      if (text) return text;
    } catch (err) {
      console.warn(
        `[@google/genai] Vision failed for ${model}: ${err.message}`
      );

      if (!err.message?.includes("404")) {
        // Continue to the other configured Gemini methods.
        console.warn(
          "[Gemini OCR] Trying the next API method."
        );
      }
    }
  }

  // 2. Legacy Google Generative AI SDK
  if (GoogleGenerativeAIClass) {
    try {
      const genAI = new GoogleGenerativeAIClass(apiKey);

      const generativeModel = genAI.getGenerativeModel({
        model,
      });

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
      const text = response.text()?.trim() || "";

      if (text) return text;
    } catch (err) {
      console.warn(
        `[@google/generative-ai] Vision failed: ${err.message}`
      );
    }
  }

  // 3. Native REST fallback
  const candidateModels = [
    model,
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-3.8-flash",
  ].filter((m, i, arr) => m && arr.indexOf(m) === i);

  for (const candidate of candidateModels) {
    try {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${candidate}:generateContent?key=${encodeURIComponent(apiKey)}`;

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

      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        120000
      );

      let response;

      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorText = await response.text();

        console.warn(
          `[Gemini REST] ${candidate} returned ${response.status}: ${errorText.slice(0, 200)}`
        );

        continue;
      }

      const data = await response.json();

      const candidateText =
        data?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("") || "";

      if (candidateText.trim()) {
        return candidateText.trim();
      }
    } catch (error) {
      console.warn(
        `[Gemini REST] Request failed for ${candidate}: ${error.message}`
      );
    }
  }

  return "";
}

// ============================================================
// GEMINI OCR ENGINE
// ============================================================

async function runGeminiOCR(
  buffer,
  mimeType,
  originalName = ""
) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey || !buffer || !buffer.length) {
    console.warn(
      "[GEMINI OCR] Missing API key or file buffer."
    );

    return "";
  }

  const model =
    process.env.GEMINI_VISION_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.8-flash";

  console.log(
    `[GEMINI OCR] Processing ${originalName || mimeType} using ${model}...`
  );

  try {
    const extracted = await callGeminiVisionAPI({
      apiKey,
      model,
      buffer,
      mimeType,
      prompt: OCR_PROMPT,
    });

    console.log(
      `[GEMINI OCR] Extracted ${extracted.length} characters.`
    );

    return extracted || "";
  } catch (error) {
    console.error(
      "[GEMINI OCR] Request failed:",
      error.message
    );

    return "";
  }
}

// ============================================================
// HYBRID OCR ORCHESTRATOR
// LOCAL LLAMA FIRST IN DEVELOPMENT
// GEMINI IN PRODUCTION
// ============================================================

async function visionExtractBuffer(
  buffer,
  originalNameOrMime = "",
  secondaryName = ""
) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0
  ) {
    console.warn("[OCR] Invalid or empty file buffer.");

    return "";
  }

  let mimeType = resolveMimeType(
    originalNameOrMime,
    buffer
  );

  if (
    mimeType === "application/octet-stream" &&
    secondaryName
  ) {
    mimeType = resolveMimeType(
      secondaryName,
      buffer
    );
  }

  if (mimeType === "application/octet-stream") {
    console.warn(
      "[OCR] Unsupported or unidentified file:",
      originalNameOrMime
    );

    return "";
  }

  if (
    mimeType === "application/pdf" &&
    buffer.length > 50 * 1024 * 1024
  ) {
    console.error(
      "[OCR] PDF exceeds the 50 MB inline OCR limit."
    );

    return "";
  }

  const mode = getOCRMode();

  console.log(
    `[OCR] Mode: ${mode} | File: ${originalNameOrMime} | MIME: ${mimeType}`
  );

  // ----------------------------------------------------------
  // LOCAL-FIRST MODE
  // ----------------------------------------------------------

  if (
    ["local", "local-first", "hybrid"].includes(mode)
  ) {
    const localText = await runLocalLlamaOCR(
      buffer,
      mimeType,
      originalNameOrMime
    );

    if (localText && localText.trim().length >= 15) {
      console.log(
        "[OCR] Selected provider: Local Llama Vision"
      );

      return localText.trim();
    }

    console.warn(
      "[OCR] Local OCR did not produce sufficient text."
    );

    if (!isGeminiFallbackEnabled()) {
      console.warn(
        "[OCR] Gemini fallback is disabled."
      );

      return "";
    }

    console.log(
      "[OCR] Falling back to Gemini Vision."
    );
  }

  // ----------------------------------------------------------
  // LOCAL-ONLY MODE
  // ----------------------------------------------------------

  if (mode === "local-only") {
    return "";
  }

  // ----------------------------------------------------------
  // GEMINI MODE / FALLBACK
  // ----------------------------------------------------------

  const geminiText = await runGeminiOCR(
    buffer,
    mimeType,
    originalNameOrMime
  );

  if (geminiText && geminiText.trim()) {
    console.log(
      "[OCR] Selected provider: Gemini Vision"
    );

    return geminiText.trim();
  }

  console.error(
    "[OCR] Both configured OCR paths failed or returned empty text."
  );

  return "";
}

// ============================================================
// FILE PATH-BASED VISION OCR
// ============================================================

async function visionExtract(
  filePath,
  originalName = ""
) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(
      "[OCR] File does not exist:",
      filePath
    );

    return "";
  }

  try {
    const buffer = fs.readFileSync(filePath);

    return await visionExtractBuffer(
      buffer,
      originalName || filePath
    );
  } catch (error) {
    console.error(
      "[OCR] File-based OCR failed:",
      error.message
    );

    return "";
  }
}

// ============================================================
// NORMAL TEXT EXTRACTION
// PDF / DOCX / TXT
// ============================================================

async function normalExtract(
  filePath,
  originalName = ""
) {
  if (!filePath || !fs.existsSync(filePath)) {
    return "";
  }

  const ext = path
    .extname(originalName || filePath)
    .toLowerCase();

  try {
    if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");

      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);

      return data.text || "";
    }

    if (ext === ".docx") {
      const mammoth = require("mammoth");

      const result = await mammoth.extractRawText({
        path: filePath,
      });

      return result.value || "";
    }

    if (ext === ".txt") {
      return fs.readFileSync(
        filePath,
        "utf8"
      );
    }

    return "";
  } catch (error) {
    console.warn(
      "[OCR] Normal extraction failed:",
      error.message
    );

    return "";
  }
}

// ============================================================
// SMART FILE EXTRACTION
// ============================================================

async function extractText(
  filePath,
  originalName = ""
) {
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn(
      "[OCR] File path does not exist:",
      filePath
    );

    return "";
  }

  const ext = path
    .extname(originalName || filePath)
    .toLowerCase();

  // ----------------------------------------------------------
  // IMAGE FILES
  // ----------------------------------------------------------

  if (IMAGE_EXTENSIONS.includes(ext)) {
    console.log(
      `[OCR] Image detected: ${originalName || filePath}`
    );

    return await visionExtract(
      filePath,
      originalName
    );
  }

  // ----------------------------------------------------------
  // PDF FILES
  // ----------------------------------------------------------

  if (ext === ".pdf") {
    console.log(
      `[OCR] PDF detected: ${originalName || filePath}`
    );

    const normalText = await normalExtract(
      filePath,
      originalName
    );

    if (
      normalText &&
      normalText.trim().length >= 100
    ) {
      console.log(
        `[OCR] Selectable PDF text found (${normalText.length} characters).`
      );

      return normalText.trim();
    }

    console.log(
      "[OCR] Scanned PDF detected. Trying Vision OCR."
    );

    // Current local Ollama implementation accepts image inputs.
    // Raw PDF input is routed to Gemini. Rendering PDF pages
    // into images can be added separately if required.
    const visionText = await visionExtract(
      filePath,
      originalName
    );

    if (visionText && visionText.trim()) {
      return visionText.trim();
    }

    return normalText?.trim() || "";
  }

  // ----------------------------------------------------------
  // DOCX / TXT
  // ----------------------------------------------------------

  return await normalExtract(
    filePath,
    originalName
  );
}

// ============================================================
// NORMALIZATION FOR DUPLICATE DETECTION
// ============================================================

function normalize(text) {
  if (!text) return [];

  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2 &&
        !BOILERPLATE_WORDS.has(word)
    );
}

// ============================================================
// CREATE BIGRAMS
// ============================================================

function createBigrams(words) {
  const shingles = new Set();

  for (let i = 0; i < words.length - 1; i++) {
    shingles.add(
      `${words[i]} ${words[i + 1]}`
    );
  }

  return shingles;
}

// ============================================================
// SIMILARITY CALCULATION
// ============================================================

function calculateSimilarity(textA, textB) {
  const wordsA = normalize(textA);
  const wordsB = normalize(textB);

  if (!wordsA.length || !wordsB.length) {
    return 0;
  }

  // Word-level Jaccard similarity
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let wordIntersect = 0;

  for (const word of setA) {
    if (setB.has(word)) {
      wordIntersect++;
    }
  }

  const wordUnion =
    setA.size + setB.size - wordIntersect;

  const wordSim = wordUnion
    ? wordIntersect / wordUnion
    : 0;

  // Bigram Jaccard similarity
  const bigramsA = createBigrams(wordsA);
  const bigramsB = createBigrams(wordsB);

  let bigramSim = 0;

  if (bigramsA.size && bigramsB.size) {
    let bigramIntersect = 0;

    for (const bigram of bigramsA) {
      if (bigramsB.has(bigram)) {
        bigramIntersect++;
      }
    }

    const bigramUnion =
      bigramsA.size +
      bigramsB.size -
      bigramIntersect;

    bigramSim = bigramUnion
      ? bigramIntersect / bigramUnion
      : 0;
  }

  const composite =
    bigramSim * 0.65 +
    wordSim * 0.35;

  return Math.round(composite * 100);
}

// ============================================================
// LEGACY JACCARD SIMILARITY
// ============================================================

function similarity(textA, textB) {
  return calculateSimilarity(textA, textB) / 100;
}

// ============================================================
// EXTERNAL PLAGIARISM API OR LOCAL FALLBACK
// ============================================================

async function externalSimilarity(
  textA,
  textB
) {
  const url = process.env.PLAGIARISM_API_URL;
  const key = process.env.PLAGIARISM_API_KEY;

  if (!url || !key) {
    return similarity(textA, textB);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        textA,
        textB,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Plagiarism API returned ${response.status}`
      );
    }

    const data = await response.json();

    if (typeof data.similarity === "number") {
      return Math.max(
        0,
        Math.min(1, data.similarity)
      );
    }
  } catch (error) {
    console.warn(
      "[DUPLICATE] External similarity API failed:",
      error.message
    );
  }

  return similarity(textA, textB);
}

// ============================================================
// KEYWORD OVERLAP SCORING
// FALLBACK IF AI GRADING FAILS
// ============================================================

function scoreAgainstKey(
  submissionText,
  answerKey,
  totalMarks = 100
) {
  const keyTerms = [
    ...new Set(normalize(answerKey)),
  ];

  if (!keyTerms.length) return 0;

  const submissionTerms = new Set(
    normalize(submissionText)
  );

  const matched = keyTerms.filter(
    (term) => submissionTerms.has(term)
  ).length;

  const ratio = matched / keyTerms.length;

  return Math.max(
    0,
    Math.min(
      totalMarks,
      Math.round(ratio * totalMarks)
    )
  );
}

// ============================================================
// AUTO CORRECTION WORKFLOW
// OCR -> DUPLICATE DETECTION -> AI GRADING
// ============================================================

async function autoCorrectAssignment(
  submissions,
  answerKey,
  totalMarks = 100,
  assignmentTitle = "Assignment"
) {
  const texts = {};

  // 1. OCR EVERY SUBMISSION
  for (const submission of submissions) {
    const filePath =
      submission.file_path ||
      submission.file_url;

    const originalName =
      submission.file_original ||
      submission.original_filename ||
      "";

    console.log(
      `[AUTO CORRECT] Extracting submission ${submission.id} (${originalName})...`
    );

    if (
      filePath &&
      typeof filePath === "string" &&
      fs.existsSync(filePath)
    ) {
      texts[submission.id] = await extractText(
        filePath,
        originalName
      );
    } else {
      texts[submission.id] = "";
    }
  }

  const results = [];

  // 2. GRADE AND CHECK DUPLICATES
  for (let i = 0; i < submissions.length; i++) {
    const submission = submissions[i];

    const text = texts[submission.id] || "";

    const needsReview =
      text.trim().length < 20;

    let autoMarks = 0;
    let feedback = "";
    let gradedBy = "none";

    if (!needsReview) {
      if (i > 0) {
        await sleep(1500);
      }

      const aiResult = await gradeWithAI(
        assignmentTitle,
        answerKey,
        text,
        totalMarks
      );

      if (aiResult) {
        autoMarks = Math.max(
          0,
          Math.min(
            totalMarks,
            Number(
              aiResult.marks ??
              aiResult.marksObtained ??
              0
            ) || 0
          )
        );

        feedback =
          aiResult.feedback ||
          "Automated grading completed.";

        gradedBy = "ai";
      } else {
        // Preserve the existing fallback scoring behavior.
        autoMarks = scoreAgainstKey(
          text,
          answerKey,
          totalMarks
        );

        feedback =
          "AI grading was unavailable. Keyword-based fallback scoring was used.";

        gradedBy = "keyword";
      }
    } else {
      feedback =
        "No readable student answer was extracted. Manual review required.";

      gradedBy = "manual_review";
    }

    // 3. DUPLICATE DETECTION
    let maxSim = 0;

    for (const other of submissions) {
      if (other.id === submission.id) continue;

      const otherText =
        texts[other.id] || "";

      if (!text.trim() || !otherText.trim()) {
        continue;
      }

      const simPct = calculateSimilarity(
        text,
        otherText
      );

      const sim = simPct / 100;

      if (sim > maxSim) {
        maxSim = sim;
      }
    }

    const similarityPct = Math.round(
      maxSim * 100
    );

    const duplicateFlag =
      similarityPct >= 70 ? 1 : 0;

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

// ============================================================
// EXPORTS
// PRESERVE EXISTING IMPORT COMPATIBILITY
// ============================================================

module.exports = {
  extractText,
  visionExtract,
  visionExtractBuffer,
  normalExtract,
  resolveMimeType,
  runLocalLlamaOCR,
  runGeminiOCR,
  calculateSimilarity,
  similarity,
  externalSimilarity,
  scoreAgainstKey,
  autoCorrectAssignment,
};
