// backend/utils/aiGrading.js

const { GoogleGenAI } = require("@google/genai");

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Grade student submission using Google Gemini AI.
 *
 * Features:
 * - Question-wise evaluation
 * - Partial marks
 * - Handwritten OCR tolerance
 * - Valid alternative answers accepted
 * - Numerical/calculation checking
 * - SQL/code logic checking
 * - Manual-review flag for unclear OCR
 * - Automatic retry on Gemini 429 rate limits
 */
async function gradeWithAI(
  assignmentTitle,
  answerKey,
  studentAnswer,
  totalMarks = 100,
  maxRetries = 3
) {
  const provider = (
    process.env.AI_PROVIDER || "gemini"
  ).toLowerCase();

  if (provider !== "gemini") {
    return null;
  }

  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.warn(
      "Gemini API key missing. Falling back to local scoring."
    );

    return null;
  }

  if (
    !studentAnswer ||
    !String(studentAnswer).trim()
  ) {
    return {
      marks: 0,
      feedback:
        "No readable student answer was detected. Manual review required.",
      questions: [],
      reviewRequired: true,
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
  });

  const modelName =
    process.env.GEMINI_MODEL ||
    "gemini-3.8-flash";

  /*
   * ============================================================
   * GRADING PROMPT
   * ============================================================
   */

  const prompt = `
You are a strict but fair university faculty grading assistant.

Your job is to evaluate a student's assignment against the official
reference answer key.

Do NOT grade based on simple text similarity.

Evaluate the actual meaning, correctness, logic, calculations,
SQL/code, and concepts in the student's answer.

--------------------------------------------------
ASSIGNMENT
--------------------------------------------------

Assignment Title:
${assignmentTitle}

Maximum Total Marks:
${totalMarks}

--------------------------------------------------
REFERENCE ANSWER KEY
--------------------------------------------------

${answerKey}

--------------------------------------------------
STUDENT SUBMISSION
--------------------------------------------------

${studentAnswer}

--------------------------------------------------
IMPORTANT GRADING RULES
--------------------------------------------------

1. Compare the student answer against the reference answer key.

2. Grade QUESTION BY QUESTION whenever question numbers can be
   identified.

3. Do NOT require the student to use exactly the same wording as
   the answer key.

4. Accept technically valid alternative answers.

5. Accept equivalent SQL statements when they satisfy the
   requirement.

6. Accept equivalent programming solutions when the logic is correct.

7. For numerical problems:
   - Check the actual calculation.
   - Check intermediate steps when appropriate.
   - Give partial marks if the method is correct but the final
     calculation contains an error.

8. For SQL:
   - Check table/column names.
   - Check constraints.
   - Check SQL logic.
   - Do not penalize merely because a constraint name is different.

9. For handwritten submissions, OCR may introduce small errors.
   Do NOT penalize an obvious OCR mistake when the intended answer
   is clear from context.

10. Preserve the meaning of hexadecimal values, mathematical
    symbols, operators, SQL syntax, and programming code when
    evaluating.

11. If the OCR contains "[UNCLEAR]", evaluate the readable parts.
    Do not automatically mark the answer wrong.

12. If an answer is partially correct, award partial marks.

13. If an answer contains the correct approach but has a minor
    mistake, award appropriate partial marks.

14. If the answer is completely unrelated to the question, award
    zero for that question.

15. Do not invent information that is not present in either the
    answer key or student answer.

16. Do not assume that two answers are duplicates simply because
    they use common academic terminology.

17. Do not determine whether the student is a particular person
    based on handwriting.

18. If the submission cannot be reliably read or important content
    is missing, set reviewRequired to true.

19. The final marks MUST NOT exceed the maximum total marks.

20. The question marks must add up to the final marks obtained.

--------------------------------------------------
AI / ORIGINALITY FLAG
--------------------------------------------------

If the answer appears suspicious because of unusual patterns,
missing readable content, or other reasons requiring faculty
attention, set reviewRequired to true.

Do NOT claim with certainty that the student used AI.

Use the flag only to request faculty review.

--------------------------------------------------
OUTPUT
--------------------------------------------------

Return ONLY valid JSON.

Use exactly this structure:

{
  "marksObtained": 0,
  "feedback": "Overall grading feedback",
  "reviewRequired": false,
  "questions": [
    {
      "question": "1",
      "marks": 0,
      "status": "correct",
      "feedback": "Explanation"
    }
  ]
}

Allowed status values:

"correct"
"partial"
"wrong"
"unclear"

--------------------------------------------------
FINAL CHECK
--------------------------------------------------

Before returning the JSON:

1. Verify that marksObtained is a number.
2. Verify that marksObtained is between 0 and ${totalMarks}.
3. Verify that all question marks add up correctly.
4. Verify that the JSON is valid.
5. Return ONLY JSON.
`;

  /*
   * ============================================================
   * GEMINI REQUEST + RETRY
   * ============================================================
   */

  for (
    let attempt = 1;
    attempt <= maxRetries;
    attempt++
  ) {
    try {
      const response =
        await ai.models.generateContent({
          model: modelName,

          contents: [
            {
              role: "user",
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],

          config: {
            responseMimeType:
              "application/json",

            temperature: 0.1,
          },
        });

      /*
       * Get Gemini response
       */

      const rawText =
        response.text
          ? response.text.trim()
          : "";

      if (!rawText) {
        throw new Error(
          "Gemini returned an empty response."
        );
      }

      /*
       * Remove accidental markdown fences
       */

      const cleanText =
        rawText
          .replace(
            /^```(?:json)?\s*/i,
            ""
          )
          .replace(
            /\s*```$/,
            ""
          )
          .trim();

      /*
       * Parse JSON
       */

      const parsed =
        JSON.parse(cleanText);

      /*
       * Validate marks
       */

      let marks =
        Number(
          parsed.marksObtained
        );

      if (
        Number.isNaN(marks)
      ) {
        marks = 0;
      }

      marks =
        Math.min(
          Math.max(
            0,
            marks
          ),
          totalMarks
        );

      /*
       * Validate question results
       */

      const questions =
        Array.isArray(
          parsed.questions
        )
          ? parsed.questions.map(
              (q) => {
                let qMarks =
                  Number(
                    q.marks
                  );

                if (
                  Number.isNaN(
                    qMarks
                  )
                ) {
                  qMarks = 0;
                }

                return {
                  question:
                    String(
                      q.question ||
                      ""
                    ),

                  marks:
                    Math.max(
                      0,
                      qMarks
                    ),

                  status:
                    [
                      "correct",
                      "partial",
                      "wrong",
                      "unclear",
                    ].includes(
                      q.status
                    )
                      ? q.status
                      : "unclear",

                  feedback:
                    String(
                      q.feedback ||
                      ""
                    ),
                };
              }
            )
          : [];

      /*
       * Determine whether manual review is needed.
       */

      const reviewRequired =
        Boolean(
          parsed.reviewRequired
        ) ||
        questions.some(
          (q) =>
            q.status ===
            "unclear"
        );

      /*
       * Return result
       */

      return {
        marks,

        feedback:
          parsed.feedback ||
          "Automated grading completed.",

        questions,

        reviewRequired,
      };
    } catch (error) {
      const errorMessage =
        error?.message ||
        String(error);

      /*
       * Gemini rate limit
       */

      const isRateLimit =
        errorMessage.includes(
          "429"
        ) ||
        errorMessage.includes(
          "RESOURCE_EXHAUSTED"
        );

      if (
        isRateLimit &&
        attempt < maxRetries
      ) {
        const waitTime =
          12000 * attempt;

        console.warn(
          `[Gemini Rate Limit] 429 received. Waiting ${
            waitTime / 1000
          }s before retry ${attempt}/${maxRetries}...`
        );

        await sleep(
          waitTime
        );

        continue;
      }

      /*
       * JSON parsing error
       */

      if (
        error instanceof
        SyntaxError
      ) {
        console.error(
          "Gemini returned invalid JSON:",
          errorMessage
        );
      } else {
        console.error(
          "Gemini grading error:",
          errorMessage
        );
      }

      /*
       * Final failure.
       * grading.js can use its local fallback.
       */

      return null;
    }
  }

  return null;
}

module.exports = {
  gradeWithAI,
};