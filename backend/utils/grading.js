// backend/utils/grading.js
const fs = require("fs");
const path = require("path");
const { gradeWithAI } = require("./aiGrading");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ocrExtract(filePath) {
  return null;
}

async function extractText(filePath, originalName) {
  if (!filePath || !fs.existsSync(filePath)) return "";
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
    if ([".jpg", ".jpeg", ".png", ".bmp", ".webp"].includes(ext)) {
      const ocr = await ocrExtract(filePath);
      return ocr || "";
    }
  } catch (e) {
    console.warn("Text extraction failed for", originalName || filePath, e.message);
  }
  return "";
}

function normalize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/** Keyword-overlap score against the answer key, scaled to totalMarks. */
function scoreAgainstKey(submissionText, answerKey, totalMarks = 100) {
  const keyTerms = [...new Set(normalize(answerKey))];
  if (!keyTerms.length) return 0;
  const subTerms = new Set(normalize(submissionText));
  const matched = keyTerms.filter((t) => subTerms.has(t)).length;
  const ratio = matched / keyTerms.length;
  return Math.max(0, Math.min(totalMarks, Math.round(ratio * totalMarks)));
}

/** Jaccard similarity between two texts using word shingles. */
function similarity(textA, textB) {
  const a = new Set(normalize(textA));
  const b = new Set(normalize(textB));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union ? intersection / union : 0;
}

/** Optional external plagiarism API hook - falls back to local similarity. */
async function externalSimilarity(textA, textB) {
  const url = process.env.PLAGIARISM_API_URL;
  const key = process.env.PLAGIARISM_API_KEY;
  if (!url || !key) return similarity(textA, textB);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ textA, textB }),
    });
    const data = await res.json();
    if (typeof data.similarity === "number") return data.similarity;
  } catch (e) {
    console.warn("Plagiarism API call failed, using local similarity instead:", e.message);
  }
  return similarity(textA, textB);
}

/**
 * Auto-correct submissions for an assignment with rate-limiting protection.
 */
async function autoCorrectAssignment(submissions, answerKey, totalMarks = 100, assignmentTitle = "Assignment") {
  const texts = {};
  for (const s of submissions) {
    const filePath = s.file_path || s.file_url;
    const originalName = s.file_original || s.original_filename || "";
    texts[s.id] = await extractText(filePath, originalName);
  }

  const results = [];
  for (let i = 0; i < submissions.length; i++) {
    const s = submissions[i];
    const text = texts[s.id] || "";
    const needsReview = text.trim().length < 20;

    let autoMarks = null, feedback = null, gradedBy = "none";
    if (!needsReview) {
      // Pause 2 seconds between AI calls to avoid quota limits
      if (i > 0) await sleep(2000);

      const aiResult = await gradeWithAI(assignmentTitle, answerKey, text, totalMarks);
      if (aiResult) {
        autoMarks = aiResult.marks;
        feedback = aiResult.feedback;
        gradedBy = "ai";
      } else {
        autoMarks = scoreAgainstKey(text, answerKey, totalMarks);
        feedback = "Scored locally by keyword match (AI rate limited or unavailable).";
        gradedBy = "keyword";
      }
    } else {
      autoMarks = 0;
      feedback = "Submission contains insufficient extractable text. Flagged for manual review.";
      gradedBy = "manual_review";
    }

    let maxSim = 0;
    for (const other of submissions) {
      if (other.id === s.id) continue;
      const otherText = texts[other.id] || "";
      if (!text.trim() || !otherText.trim()) continue;
      const sim = await externalSimilarity(text, otherText);
      if (sim > maxSim) maxSim = sim;
    }

    results.push({
      id: s.id,
      autoMarks,
      feedback,
      gradedBy,
      similarityPct: Math.round(maxSim * 100),
      duplicateFlag: maxSim >= 0.8 ? 1 : 0,
      needsReview,
    });
  }
  return results;
}

module.exports = {
  extractText,
  scoreAgainstKey,
  similarity,
  autoCorrectAssignment,
};