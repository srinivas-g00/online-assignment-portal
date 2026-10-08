// backend/utils/aiGrading.js

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

/**
 * Execute Gemini prompt with multi-SDK and REST API fallback.
 */
async function callGeminiGenerate({ apiKey, model, prompt }) {
  // 1. Try @google/genai SDK
  if (GoogleGenAIClass) {
    try {
      const ai = new GoogleGenAIClass({ apiKey });
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const text = response?.text ? String(response.text).trim() : "";
      if (text) return text;
    } catch (err) {
      console.warn(`[@google/genai] Grading call failed for ${model}: ${err.message}`);
      if (!err.message?.includes("404")) throw err;
    }
  }

  // 2. Try @google/generative-ai SDK
  if (GoogleGenerativeAIClass) {
    try {
      const genAI = new GoogleGenerativeAIClass(apiKey);
      const generativeModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });
      const result = await generativeModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text() ? response.text().trim() : "";
      if (text) return text;
    } catch (err) {
      console.warn(`[@google/generative-ai] Grading call failed for ${model}: ${err.message}`);
      if (!err.message?.includes("404")) throw err;
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
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`[Gemini REST] Grading model ${candidate} returned ${res.status}: ${errorText.slice(0, 160)}`);
        if (res.status === 429) {
          throw new Error("429 RESOURCE_EXHAUSTED");
        }
        continue;
      }

      const data = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (rawText && rawText.trim()) {
        return rawText.trim();
      }
    } catch (fetchErr) {
      if (fetchErr.message?.includes("429")) throw fetchErr;
      console.warn(`[Gemini REST] Grading error for ${candidate}: ${fetchErr.message}`);
    }
  }

  return "";
}

/**
 * Grade student submission using Google Gemini AI against text answer key.
 *
 * Features:
 * - Robust handling of handwritten OCR transcription artifacts
 * - Question-by-question academic grading
 * - Partial marks for working steps, SQL, math, and code
 * - Tolerant of minor OCR misreadings when student intent is clear
 * - Bounds verification (0 to totalMarks)
 * - Automatic retry on rate limits
 */
async function gradeWithAI(
  assignmentTitle,
  answerKey,
  studentAnswer,
  totalMarks = 100,
  maxRetries = 3
) {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  if (provider !== "gemini") {
    return null;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("Gemini API key missing. Falling back to local scoring.");
    return null;
  }

  if (!studentAnswer || !String(studentAnswer).trim()) {
    return {
      marks: 0,
      marksObtained: 0,
      feedback: "No readable student answer was detected. Manual review required.",
      questions: [],
      reviewRequired: true,
    };
  }

  const modelName =
    process.env.GEMINI_MODEL ||
    "gemini-2.5-flash";

  const prompt = `
You are a fair and rigorous university professor grading assistant.

Your task is to evaluate a student's submission (transcribed via OCR from their handwritten or typed document) against the official reference text answer key.

DO NOT simply count keyword matches. Evaluate conceptual understanding, mathematical accuracy, logic, SQL queries, and code implementation.

--------------------------------------------------
ASSIGNMENT DETAILS
--------------------------------------------------
Assignment Title: ${assignmentTitle || "Assignment"}
Maximum Total Marks: ${totalMarks}

--------------------------------------------------
OFFICIAL TEXT ANSWER KEY
--------------------------------------------------
${answerKey}

--------------------------------------------------
STUDENT SUBMISSION (OCR TRANSCRIBED FROM HANDWRITING)
--------------------------------------------------
${studentAnswer}

--------------------------------------------------
EVALUATION GUIDELINES
--------------------------------------------------
1. Compare the student's submission against the reference answer key question by question whenever question numbers can be identified.
2. Accept technically correct alternative explanations, formulas, or equivalent SQL/code implementations.
3. HANDWRITTEN OCR TOLERANCE:
   - Because the student's work was handwritten and transcribed using OCR, minor character misrecognitions or typos (e.g., '1' vs 'l', '0' vs 'O', 'vv' vs 'w') may occur.
   - Do NOT penalize an obvious OCR artifact if the student's handwritten meaning and derivation are clearly correct.
   - If the student answer contains "[UNCLEAR]", evaluate the remaining readable portions fairly.
4. For numerical and mathematical problems:
   - Award partial credit for correct intermediate steps, formula application, and method, even if a minor arithmetic slip occurred.
5. For programming and SQL:
   - Check logic, table/column references, JOINs, WHERE conditions, and syntax structure.
   - Accept equivalent naming and variable conventions.
6. The marksObtained MUST be a number between 0 and ${totalMarks}.
7. If the submission cannot be deciphered or crucial questions are illegible, set reviewRequired to true.

--------------------------------------------------
OUTPUT FORMAT
--------------------------------------------------
Return ONLY valid JSON with this exact schema:
{
  "marksObtained": 0,
  "feedback": "Overall constructive grading feedback for the student",
  "reviewRequired": false,
  "questions": [
    {
      "question": "1",
      "marks": 0,
      "status": "correct",
      "feedback": "Evaluation explanation"
    }
  ]
}

Allowed status values: "correct", "partial", "wrong", "unclear".
`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const rawText = await callGeminiGenerate({
        apiKey,
        model: modelName,
        prompt,
      });

      if (!rawText) {
        throw new Error("Gemini returned empty grading response.");
      }

      // Clean Markdown fences if present
      const cleanText = rawText
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      const parsed = JSON.parse(cleanText);

      let marks = Number(parsed.marksObtained ?? parsed.marks);
      if (Number.isNaN(marks)) marks = 0;
      marks = Math.min(Math.max(0, marks), totalMarks);

      const questions = Array.isArray(parsed.questions)
        ? parsed.questions.map((q) => {
            let qMarks = Number(q.marks);
            if (Number.isNaN(qMarks)) qMarks = 0;
            return {
              question: String(q.question || ""),
              marks: Math.max(0, qMarks),
              status: ["correct", "partial", "wrong", "unclear"].includes(q.status)
                ? q.status
                : "unclear",
              feedback: String(q.feedback || ""),
            };
          })
        : [];

      const reviewRequired =
        Boolean(parsed.reviewRequired) ||
        questions.some((q) => q.status === "unclear");

      return {
        marks,
        marksObtained: marks,
        feedback: parsed.feedback || "Automated grading completed.",
        questions,
        reviewRequired,
      };
    } catch (error) {
      const errorMessage = error?.message || String(error);
      const isRateLimit =
        errorMessage.includes("429") ||
        errorMessage.includes("RESOURCE_EXHAUSTED");

      if (isRateLimit && attempt < maxRetries) {
        const waitTime = 10000 * attempt;
        console.warn(
          `[Gemini Rate Limit] 429 received. Waiting ${waitTime / 1000}s before retry ${attempt}/${maxRetries}...`
        );
        await sleep(waitTime);
        continue;
      }

      console.error(`Gemini grading error (attempt ${attempt}/${maxRetries}):`, errorMessage);
      if (attempt === maxRetries) return null;
    }
  }

  return null;
}

module.exports = {
  gradeWithAI,
};