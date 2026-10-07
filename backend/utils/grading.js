// backend/utils/grading.js

const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");
const { gradeWithAI } = require("./aiGrading");

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/*
 * ============================================================
 * GEMINI VISION OCR
 * ============================================================
 */

async function visionExtract(
  filePath,
  originalName = ""
) {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (
    !apiKey ||
    !filePath ||
    !fs.existsSync(filePath)
  ) {
    console.warn(
      "[OCR] Missing API key or file does not exist."
    );

    return "";
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
    });

    const ext = path
      .extname(
        originalName || filePath
      )
      .toLowerCase();

    let mimeType =
      "application/octet-stream";

    if (ext === ".pdf") {
      mimeType = "application/pdf";
    } else if (
      ext === ".jpg" ||
      ext === ".jpeg"
    ) {
      mimeType = "image/jpeg";
    } else if (ext === ".png") {
      mimeType = "image/png";
    } else if (ext === ".webp") {
      mimeType = "image/webp";
    } else if (ext === ".bmp") {
      mimeType = "image/bmp";
    }

    const buffer =
      fs.readFileSync(filePath);

    return await runGeminiOCR(
      ai,
      buffer,
      mimeType,
      originalName || filePath
    );
  } catch (error) {
    console.error(
      "[OCR] VISION OCR ERROR:",
      error?.message || error
    );

    return "";
  }
}

/*
 * ============================================================
 * BUFFER-BASED GEMINI VISION OCR
 *
 * Used by facultyRoutes.js when the uploaded submission
 * is available as a Buffer.
 * ============================================================
 */

async function visionExtractBuffer(
  buffer,
  originalName = ""
) {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (
    !apiKey ||
    !buffer ||
    !Buffer.isBuffer(buffer) ||
    buffer.length === 0
  ) {
    console.warn(
      "[OCR] Empty buffer or missing Gemini API key."
    );

    return "";
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
    });

    const ext = path
      .extname(
        String(originalName || "")
      )
      .toLowerCase();

    let mimeType =
      "application/octet-stream";

    if (ext === ".pdf") {
      mimeType = "application/pdf";
    } else if (
      ext === ".jpg" ||
      ext === ".jpeg"
    ) {
      mimeType = "image/jpeg";
    } else if (ext === ".png") {
      mimeType = "image/png";
    } else if (ext === ".webp") {
      mimeType = "image/webp";
    } else if (ext === ".bmp") {
      mimeType = "image/bmp";
    }

    console.log(
      `[OCR] Starting Gemini Vision OCR: ${originalName}`
    );

    console.log(
      `[OCR] MIME type: ${mimeType}`
    );

    console.log(
      `[OCR] File size: ${(
        buffer.length /
        1024 /
        1024
      ).toFixed(2)} MB`
    );

    if (
      mimeType ===
      "application/octet-stream"
    ) {
      console.warn(
        `[OCR] Could not determine file type for: ${originalName}`
      );

      return "";
    }

    /*
     * Gemini inline PDF processing has a practical
     * file-size limitation. Reject very large files
     * instead of silently failing.
     */

    if (
      mimeType ===
        "application/pdf" &&
      buffer.length >
        50 * 1024 * 1024
    ) {
      console.error(
        "[OCR] PDF is larger than 50 MB."
      );

      return "";
    }

    const extractedText =
      await runGeminiOCR(
        ai,
        buffer,
        mimeType,
        originalName
      );

    console.log(
      `[OCR] Final extracted text length: ${extractedText.length}`
    );

    if (
      extractedText.length > 0
    ) {
      console.log(
        "[OCR] OCR completed successfully."
      );
    } else {
      console.warn(
        "[OCR] Gemini returned no readable text."
      );
    }

    return extractedText;
  } catch (error) {
    console.error(
      "[OCR] VISION BUFFER OCR ERROR:",
      error?.message || error
    );

    return "";
  }
}

/*
 * ============================================================
 * COMMON GEMINI OCR FUNCTION
 * ============================================================
 */

async function runGeminiOCR(
  ai,
  buffer,
  mimeType,
  originalName = ""
) {
  const model =
    process.env.GEMINI_VISION_MODEL ||
    process.env.GEMINI_MODEL ||
    "gemini-3.8-flash";

  const base64 =
    buffer.toString("base64");

  /*
   * Strong OCR prompt.
   *
   * The output is intentionally plain text because
   * the result is later sent to gradeWithAI().
   */

  const prompt = `
You are an expert academic document OCR system.

You are processing a student's assignment submission.

Read the ENTIRE document carefully, including EVERY PAGE.

The document may contain:

- handwritten answers
- typed answers
- mathematical calculations
- equations
- numerical problems
- hexadecimal values
- programming code
- SQL
- tables
- diagrams
- symbols
- arrows
- formulas
- multiple questions
- multiple pages

Your task is ONLY to extract the student's actual written content.

DO NOT grade the student.

DO NOT solve the questions.

DO NOT correct the student's answers.

DO NOT summarize the document.

DO NOT add explanations.

IMPORTANT OCR RULES:

1. Preserve every question number whenever it is readable.

2. Preserve the original order of the questions.

3. Separate questions clearly.

4. Extract the student's actual answer, not the expected answer.

5. Preserve mathematical expressions.

6. Preserve numerical calculations.

7. Preserve intermediate calculation steps.

8. Preserve hexadecimal values such as:
   4000H
   14000H

9. Preserve programming code.

10. Preserve SQL syntax.

11. Preserve operators such as:
    + - * / = < > <= >=

12. Preserve negative signs.

13. Preserve brackets and parentheses when readable.

14. Preserve table contents when readable.

15. Preserve labels from diagrams when readable.

16. If handwriting is difficult but partially readable,
    extract everything that can reasonably be read.

17. If a word, number, formula, or section is genuinely
    unreadable, write [UNCLEAR].

18. Never invent missing text.

19. Do not guess an answer from general knowledge.

20. Do not correct OCR mistakes silently.

21. Do not identify the student.

22. Do not mention the student's identity.

23. Do not determine whether the student used AI.

24. Include all readable content from all pages.

25. The extracted text will be used by another AI
    for academic grading, so preserving the student's
    actual answer is the highest priority.

USE THIS FORMAT:

QUESTION 1:
[actual extracted answer]

QUESTION 2:
[actual extracted answer]

QUESTION 3:
[actual extracted answer]

Continue for every question found.

If question numbering is not visible, preserve the
order and use:

QUESTION:
[actual extracted content]

Return ONLY the extracted student answer text.
Do not wrap the answer in Markdown.
`;

  console.log(
    `[OCR] Sending ${originalName} to Gemini model ${model}...`
  );

  try {
    /*
     * ========================================================
     * PDF / IMAGE → GEMINI
     * ========================================================
     */

    const response =
      await ai.models.generateContent({
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

    const extracted =
      response?.text
        ? String(
            response.text
          ).trim()
        : "";

    console.log(
      `[OCR] Gemini returned ${extracted.length} characters.`
    );

    if (extracted) {
      return extracted;
    }

    console.warn(
      "[OCR] Gemini returned an empty response."
    );

    return "";
  } catch (error) {
    console.error(
      "[OCR] Gemini OCR request failed:",
      error?.message || error
    );

    /*
     * Log the most useful information without
     * exposing the API key.
     */

    if (error?.status) {
      console.error(
        "[OCR] Gemini status:",
        error.status
      );
    }

    if (error?.code) {
      console.error(
        "[OCR] Gemini code:",
        error.code
      );
    }

    return "";
  }
}

/*
 * ============================================================
 * NORMAL TEXT EXTRACTION
 * ============================================================
 */

async function normalExtract(
  filePath,
  originalName
) {
  const ext = path
    .extname(
      originalName || filePath
    )
    .toLowerCase();

  try {
    /*
     * --------------------------------------------------------
     * PDF
     * --------------------------------------------------------
     */

    if (ext === ".pdf") {
      const pdfParse =
        require("pdf-parse");

      const buf =
        fs.readFileSync(filePath);

      const data =
        await pdfParse(buf);

      return data.text || "";
    }

    /*
     * --------------------------------------------------------
     * DOCX
     * --------------------------------------------------------
     */

    if (ext === ".docx") {
      const mammoth =
        require("mammoth");

      const result =
        await mammoth.extractRawText({
          path: filePath,
        });

      return result.value || "";
    }

    /*
     * --------------------------------------------------------
     * TXT
     * --------------------------------------------------------
     */

    if (ext === ".txt") {
      return fs.readFileSync(
        filePath,
        "utf8"
      );
    }

    return "";
  } catch (error) {
    console.warn(
      "[OCR] NORMAL EXTRACTION ERROR:",
      error?.message || error
    );

    return "";
  }
}

/*
 * ============================================================
 * SMART EXTRACTION
 * ============================================================
 */

async function extractText(
  filePath,
  originalName
) {
  if (
    !filePath ||
    !fs.existsSync(filePath)
  ) {
    console.warn(
      "[OCR] File path does not exist:",
      filePath
    );

    return "";
  }

  const ext = path
    .extname(
      originalName || filePath
    )
    .toLowerCase();

  /*
   * --------------------------------------------------------
   * IMAGE
   *
   * Images always go directly to Gemini Vision.
   * --------------------------------------------------------
   */

  if (
    [
      ".jpg",
      ".jpeg",
      ".png",
      ".bmp",
      ".webp",
    ].includes(ext)
  ) {
    console.log(
      `[OCR] Image detected: ${originalName}`
    );

    return await visionExtract(
      filePath,
      originalName
    );
  }

  /*
   * --------------------------------------------------------
   * PDF
   *
   * First try normal PDF text extraction.
   *
   * If the PDF contains enough selectable text,
   * use it directly.
   *
   * Otherwise send the original PDF to Gemini Vision.
   * --------------------------------------------------------
   */

  if (ext === ".pdf") {
    console.log(
      `[OCR] PDF detected: ${originalName}`
    );

    const normalText =
      await normalExtract(
        filePath,
        originalName
      );

    console.log(
      `[OCR] Normal PDF extraction returned ${normalText.length} characters.`
    );

    /*
     * A handwritten/scanned PDF normally has
     * little or no selectable text.
     */

    if (
      normalText &&
      normalText.trim().length >= 100
    ) {
      console.log(
        "[OCR] Sufficient selectable PDF text found. Using normal extraction."
      );

      return normalText.trim();
    }

    console.log(
      "[OCR] PDF contains little/no selectable text."
    );

    console.log(
      "[OCR] Sending complete PDF to Gemini Vision..."
    );

    const visionText =
      await visionExtract(
        filePath,
        originalName
      );

    if (
      visionText &&
      visionText.trim()
    ) {
      return visionText.trim();
    }

    /*
     * Return normal text if Gemini OCR failed.
     * This may still contain some useful text.
     */

    return (
      normalText?.trim() ||
      ""
    );
  }

  /*
   * --------------------------------------------------------
   * DOCX / TXT
   * --------------------------------------------------------
   */

  return await normalExtract(
    filePath,
    originalName
  );
}

/*
 * ============================================================
 * NORMALIZATION
 * ============================================================
 */

function normalize(text) {
  if (!text) {
    return [];
  }

  return String(text)
    .toLowerCase()
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 2
    );
}

/*
 * ============================================================
 * KEYWORD SCORE
 *
 * Used only as a fallback when AI grading fails.
 * ============================================================
 */

function scoreAgainstKey(
  submissionText,
  answerKey,
  totalMarks = 100
) {
  const keyTerms = [
    ...new Set(
      normalize(answerKey)
    ),
  ];

  if (!keyTerms.length) {
    return 0;
  }

  const subTerms =
    new Set(
      normalize(submissionText)
    );

  const matched =
    keyTerms.filter(
      (term) =>
        subTerms.has(term)
    ).length;

  const ratio =
    matched / keyTerms.length;

  return Math.max(
    0,
    Math.min(
      totalMarks,
      Math.round(
        ratio * totalMarks
      )
    )
  );
}

/*
 * ============================================================
 * TEXT SIMILARITY
 *
 * Used for duplicate-answer detection.
 * ============================================================
 */

function similarity(
  textA,
  textB
) {
  const a =
    new Set(
      normalize(textA)
    );

  const b =
    new Set(
      normalize(textB)
    );

  if (
    !a.size ||
    !b.size
  ) {
    return 0;
  }

  let intersection = 0;

  for (
    const word of a
  ) {
    if (b.has(word)) {
      intersection++;
    }
  }

  const union =
    a.size +
    b.size -
    intersection;

  return union
    ? intersection / union
    : 0;
}

/*
 * ============================================================
 * EXTERNAL SIMILARITY
 * ============================================================
 */

async function externalSimilarity(
  textA,
  textB
) {
  const url =
    process.env.PLAGIARISM_API_URL;

  const key =
    process.env.PLAGIARISM_API_KEY;

  /*
   * If no external plagiarism service is configured,
   * use the local similarity calculation.
   */

  if (!url || !key) {
    return similarity(
      textA,
      textB
    );
  }

  try {
    const res =
      await fetch(url, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${key}`,
        },

        body: JSON.stringify({
          textA,
          textB,
        }),
      });

    const data =
      await res.json();

    if (
      typeof data.similarity ===
      "number"
    ) {
      return Math.max(
        0,
        Math.min(
          1,
          data.similarity
        )
      );
    }
  } catch (error) {
    console.warn(
      "[DUPLICATE] Similarity API failed:",
      error?.message || error
    );
  }

  return similarity(
    textA,
    textB
  );
}

/*
 * ============================================================
 * AUTO CORRECTION
 * ============================================================
 */

async function autoCorrectAssignment(
  submissions,
  answerKey,
  totalMarks = 100,
  assignmentTitle = "Assignment"
) {
  const texts = {};

  /*
   * --------------------------------------------------------
   * OCR EVERY SUBMISSION
   * --------------------------------------------------------
   */

  for (
    const submission
    of submissions
  ) {
    const filePath =
      submission.file_path ||
      submission.file_url;

    const originalName =
      submission.file_original ||
      submission.original_filename ||
      "";

    console.log(
      "============================================================"
    );

    console.log(
      `[AUTO CORRECT] Processing submission ${submission.id}`
    );

    console.log(
      `[AUTO CORRECT] File: ${originalName}`
    );

    /*
     * Try normal path-based extraction first.
     */

    if (
      filePath &&
      typeof filePath === "string" &&
      fs.existsSync(filePath)
    ) {
      texts[submission.id] =
        await extractText(
          filePath,
          originalName
        );
    } else {
      /*
       * If the file is not physically available,
       * facultyRoutes.js should normally handle the
       * storage download and Buffer OCR.
       */

      console.warn(
        `[AUTO CORRECT] File path unavailable for submission ${submission.id}.`
      );

      texts[submission.id] = "";
    }

    console.log(
      `[AUTO CORRECT] Extracted text length: ${
        texts[submission.id]
          ? texts[submission.id].length
          : 0
      }`
    );
  }

  const results = [];

  /*
   * --------------------------------------------------------
   * GRADE EACH SUBMISSION
   * --------------------------------------------------------
   */

  for (
    let i = 0;
    i < submissions.length;
    i++
  ) {
    const submission =
      submissions[i];

    const text =
      texts[submission.id] ||
      "";

    /*
     * Very short OCR result means the submission
     * probably could not be read.
     */

    const needsReview =
      text.trim().length < 20;

    let autoMarks = 0;
    let feedback = "";
    let gradedBy = "none";

    /*
     * ------------------------------------------------------
     * AI GRADING
     * ------------------------------------------------------
     */

    if (!needsReview) {
      /*
       * Small delay between requests to reduce
       * rate-limit problems.
       */

      if (i > 0) {
        await sleep(2000);
      }

      console.log(
        `[AUTO CORRECT] Sending submission ${submission.id} to Gemini grading...`
      );

      const aiResult =
        await gradeWithAI(
          assignmentTitle,
          answerKey,
          text,
          totalMarks
        );

      if (aiResult) {
        autoMarks =
          Number(
            aiResult.marks
          ) || 0;

        feedback =
          aiResult.feedback ||
          "Automated grading completed.";

        gradedBy = "ai";

        console.log(
          `[AUTO CORRECT] AI grading completed: ${autoMarks}/${totalMarks}`
        );
      } else {
        /*
         * AI grading failed.
         * Use local keyword fallback.
         */

        autoMarks =
          scoreAgainstKey(
            text,
            answerKey,
            totalMarks
          );

        feedback =
          "AI grading was unavailable. Keyword-based fallback scoring was used.";

        gradedBy = "keyword";

        console.warn(
          `[AUTO CORRECT] AI grading failed. Fallback score: ${autoMarks}/${totalMarks}`
        );
      }
    } else {
      /*
       * ----------------------------------------------------
       * MANUAL REVIEW
       * ----------------------------------------------------
       */

      feedback =
        "No readable student answer was extracted from the submission. Manual review required.";

      gradedBy =
        "manual_review";

      console.warn(
        `[AUTO CORRECT] Submission ${submission.id} requires manual review because OCR returned insufficient text.`
      );
    }

    /*
     * --------------------------------------------------------
     * DUPLICATE DETECTION
     * --------------------------------------------------------
     */

    let maxSim = 0;

    for (
      const other
      of submissions
    ) {
      if (
        other.id ===
        submission.id
      ) {
        continue;
      }

      const otherText =
        texts[other.id] ||
        "";

      if (
        !text.trim() ||
        !otherText.trim()
      ) {
        continue;
      }

      const sim =
        await externalSimilarity(
          text,
          otherText
        );

      if (
        sim > maxSim
      ) {
        maxSim = sim;
      }
    }

    const similarityPct =
      Math.round(
        maxSim * 100
      );

    const duplicateFlag =
      maxSim >= 0.80
        ? 1
        : 0;

    console.log(
      `[DUPLICATE] Submission ${submission.id}: ${similarityPct}% similarity`
    );

    /*
     * --------------------------------------------------------
     * FINAL RESULT
     * --------------------------------------------------------
     */

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

  console.log(
    "============================================================"
  );

  console.log(
    "[AUTO CORRECT] Completed."
  );

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
  scoreAgainstKey,
  similarity,
  externalSimilarity,
  autoCorrectAssignment,
};