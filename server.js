const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const { GoogleGenAI } = require('@google/genai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const VALID_MISTAKE_TYPES = [
  'Calculation error',
  'Incorrect operation',
  'Conceptual misunderstanding',
  'Formula misuse',
  'Logical reasoning error',
  'Missing step',
  'Sign error',
  'Unit error',
  'Correct reasoning',
  'None'
].join(', ');

const BASE_SYSTEM_PROMPT = `You are Socratic, an AI tutor designed to help students learn by reasoning rather than copying answers.

Your job is NOT to immediately solve the student's problem.
Analyze the exact question and work supplied. Do not assume the subject, substitute an example, or invent missing work.
First identify what the student is trying to do, then identify a specific reasoning gap if one exists.
Keep the response beginner-friendly. Include one useful Socratic question and a small hint.
The requested guidance level controls detail: level 1 is a gentle question, level 2 is a clearer direction, and level 3 is stronger guidance. Do not jump ahead of the requested level.

You will receive:
1. The question.
2. The student's attempted solution.
3. The current guidance level.
4. Whether this is a re-check after a previous attempt.
5. Optional image data if the learner uploaded handwritten work.
6. The selected or automatically detected problem type and programming language.

Analyze the student's reasoning carefully.

If the attempt is incorrect:
- Identify the exact step where the reasoning goes wrong.
- Determine the type of mistake.
- Do not reveal the final answer.
- At guidance level 1, ask a gentle Socratic question.
- At guidance level 2, provide a more specific conceptual hint.
- At guidance level 3, provide a near-step-by-step hint without directly completing the entire problem.

If the attempt is correct:
- Confirm that the reasoning is correct.
- Briefly explain why.
- Provide the final result only after the student has demonstrated correct reasoning.

Use only the mistake types from this list: ${VALID_MISTAKE_TYPES}.

Return valid JSON only with this exact structure:
{
  "correct": false,
  "mistakeType": "Incorrect operation",
  "whatINoticed": "...",
  "socraticQuestion": "...",
  "hint": "...",
  "nextStep": "...",
  "concept": "...",
  "finalAnswer": "",
  "whatChanged": "",
  "whyItWorks": ""
}

If correct, use:
{
  "correct": true,
  "mistakeType": "Correct reasoning",
  "whatINoticed": "...",
  "socraticQuestion": "...",
  "hint": "...",
  "nextStep": "...",
  "concept": "...",
  "finalAnswer": "...",
  "whatChanged": "...",
  "whyItWorks": "..."
}

Keep the response concise, structured, and educational.`;

const PROGRAMMING_TUTOR_PROMPT = `For programming, LeetCode, DSA, algorithm, and debugging problems:
- Be a patient tutor for a beginner. Use short, plain sentences. Explain any necessary technical term simply.
- Read the problem statement, constraints, code, and approach before judging correctness.
- Detect the programming language from the code when possible; do not guess if uncertain.
- If there is no code or approach, do not solve the problem. Ask what the learner would do manually first.
- If the code is wrong, point to the relevant condition, loop, boundary, or reasoning issue in words. Do not rewrite code or paste a corrected solution.
- If the approach is correct but inefficient, explain in everyday language what repeats and ask what could be remembered.
- Use beginner-friendly hint progression: level 1 asks one conceptual question; level 2 gives a clearer direction; level 3 may name a useful data structure and explain it simply, but still does not provide full code or a complete algorithm.
- Do not jump straight to an optimal algorithm, data structure, or complete implementation. Introduce ideas only as the hint level permits.
- Mention complexity only when useful, and explain it plainly (for example, two nested loops may check many pairs as input grows).
- When the learner is close, acknowledge the good part before describing the issue.
- A code or approach is correct only when supported by the supplied work and problem requirements. Never claim correctness from a guessed solution.
- On success, explain what the learner did correctly and why. Return a final result or complexity only if the supplied attempt demonstrates the correct reasoning.
- Never include full code in any response field.

For common Two Sum beginner attempts, do not say “HashMap” at level 1 or 2. Level 1: ask how they might remember a number already seen. Level 2: ask what value is needed with the current number to reach the target. Level 3: ask what structure can quickly check whether that needed value was seen; only then may you explain a map as a quick lookup.

For other coding problems, derive hints from the actual supplied work and use the same gradual progression.`;

function looksLikeProgramming(question, attempt) {
  const text = `${question || ''}\n${attempt || ''}`;
  return /\b(leetcode|dsa|programming|coding question|data structures|algorithms?|debugging|runtime error|time limit exceeded|constraints|test cases|input:|output:|return\s+true|return\s+false|public\s+(?:static\s+)?(?:int|void|boolean|class)|class\s+solution|def\s+\w+\s*\(|function\s+\w+\s*\(|vector\s*<|#include\s*<|nums(?:\.length|\s*\[)|arraylist|hashmap|binary search|valid parentheses|two sum|sorted array|target value|code:)\b/i.test(text)
    || /\b(?:for|while)\s*\(/i.test(text)
    || /(?:two numbers|two integers).{0,80}(?:sum|target)|(?:sum|target).{0,80}(?:two numbers|two integers)|\b(?:sorted|array|target).{0,80}\b(?:search|index|return)\b/i.test(text);
}

function detectLanguage(attempt, selectedLanguage) {
  if (selectedLanguage && selectedLanguage !== 'auto') return selectedLanguage;
  const code = attempt || '';
  if (/\bdef\s+\w+\s*\(|\bNone\b|\bself\b|:\s*(?:#.*)?$/m.test(code)) return 'Python';
  if (/#include\s*<|std::|using namespace std|vector\s*</i.test(code)) return 'C++';
  if (/\bpublic\s+(?:static\s+)?(?:int|void|boolean|class)|\bSystem\.out\.println|\bnew\s+int\s*\[/i.test(code)) return 'Java';
  if (/\bfun\s+\w+|val\s+\w+|var\s+\w+|println\(/i.test(code)) return 'Kotlin';
  if (/\b#include\s*<stdio\.h>|\bprintf\s*\(/i.test(code)) return 'C';
  if (/\b(const|let|var)\s+\w+|=>|console\.log|function\s+\w+\s*\(/i.test(code)) return 'JavaScript';
  return 'Not sure';
}

function parseImageDataUrl(imageDataUrl) {
  if (!imageDataUrl) return null;
  if (typeof imageDataUrl !== 'string') {
    throw new Error('Invalid image data.');
  }

  const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new Error('Use a PNG, JPG, or WebP image.');
  }

  const imageBuffer = Buffer.from(match[2], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 3 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 3 MB.');
  }

  return { mimeType: match[1], data: match[2] };
}

function safeJsonParse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty AI response');
  }

  const cleaned = rawText.trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON in model output');
  }

  const jsonText = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(jsonText);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Malformed AI object');
  }

  const requiredTextFields = ['mistakeType', 'whatINoticed', 'socraticQuestion', 'hint', 'nextStep', 'concept'];
  if (typeof parsed.correct !== 'boolean' || requiredTextFields.some(field => typeof parsed[field] !== 'string' || !parsed[field].trim())) {
    throw new Error('AI response is missing required tutoring fields');
  }

  for (const field of ['finalAnswer', 'whatChanged', 'whyItWorks']) {
    if (parsed[field] !== undefined && typeof parsed[field] !== 'string') {
      throw new Error(`AI response field ${field} must be text`);
    }
  }

  return {
    correct: parsed.correct,
    mistakeType: parsed.mistakeType,
    whatINoticed: parsed.whatINoticed,
    socraticQuestion: parsed.socraticQuestion,
    hint: parsed.hint,
    nextStep: parsed.nextStep,
    concept: parsed.concept,
    finalAnswer: parsed.finalAnswer || '',
    whatChanged: parsed.whatChanged || '',
    whyItWorks: parsed.whyItWorks || ''
  };
}

function fallbackProgrammingResponse({ question, attempt, previousAttempt, newAttempt, hintLevel, language }) {
  const questionText = (question || '').toLowerCase();
  const attemptText = (newAttempt || previousAttempt || attempt || '').trim();
  const level = Math.max(1, Math.min(Number(hintLevel) || 1, 3));
  const noCode = !attemptText;
  let socraticQuestion = 'What would you try first if you solved a small example by hand?';
  let hint = 'Start with a tiny input and describe each step you would take.';
  let nextStep = 'Write down what information you need to keep track of as you work through the example.';
  let whatINoticed = noCode
    ? 'You have shared the problem, but not your approach or code yet.'
    : `I can see your ${language && language !== 'Not sure' ? `${language} ` : ''}attempt. Test its logic on a small example and trace what each step does.`;
  let mistakeType = noCode ? 'Missing step' : 'Logical reasoning error';
  let concept = 'Trace a small example carefully, keeping track of the input, the state of your variables, and the expected result.';

  if (/two sum|two integers|sum of two|two numbers.{0,80}(?:add|sum|target)|(?:add|sum|target).{0,80}(?:two numbers|two integers)|nums.{0,50}target|target.{0,50}nums|indices.{0,50}target/i.test(questionText)) {
    whatINoticed = noCode
      ? 'You have shared the Two Sum problem, but not your approach or code yet.'
      : 'Your approach checks possible pairs. Think about what you could remember while moving through the numbers.';
    mistakeType = noCode ? 'Missing step' : 'Logical reasoning error';
    concept = 'For each number, compare what you need with the information you have already seen.';

    if (noCode) {
      socraticQuestion = 'Before thinking about code, what would you do if you solved this with a few numbers by hand?';
      hint = 'Try one small example and say what you look for at each step.';
      nextStep = 'Describe what you would need to remember as you scan the numbers.';
    } else if (level === 1) {
      socraticQuestion = 'You are checking pairs. Is there a way to remember a number you have already seen?';
      hint = 'Think about what information from earlier in the list might help with the current number.';
      nextStep = 'Try tracing your approach on a small list and notice what gets repeated.';
    } else if (level === 2) {
      socraticQuestion = 'If you know the current number and the target, what other number are you looking for?';
      hint = 'Work out the missing value needed to make the current number reach the target.';
      nextStep = 'Consider how to check whether that needed value appeared earlier.';
    } else {
      socraticQuestion = 'What kind of structure could quickly tell you whether that needed value was seen already?';
      hint = 'A map can store each value you have passed so far and let you look it up. A map is like a quick lookup list.';
      nextStep = 'Work out what value and position you would store, and when you would check the map. Try implementing that idea yourself.';
    }
  } else if (/valid parentheses|balanced parentheses|brackets/i.test(questionText)) {
    whatINoticed = noCode
      ? 'You have shared the bracket-matching problem, but not your approach or code yet.'
      : 'The important part is matching each closing bracket with the most recent opening bracket that is still waiting to be matched.';
    mistakeType = noCode ? 'Missing step' : 'Logical reasoning error';
    concept = 'Nested brackets must close in the reverse order that they opened.';
    if (noCode) {
      socraticQuestion = 'What would you do by hand when you see an opening bracket and then its closing bracket?';
      hint = 'Try a short string with nested brackets and describe which pair must close first.';
      nextStep = 'Think about what information from the opening brackets you need to remember.';
    } else if (level === 1) {
      socraticQuestion = 'When a closing bracket appears, which opening bracket should it match?';
      hint = 'Try tracing a small nested example and notice which opener is still waiting.';
      nextStep = 'Check whether your code remembers the most recent unmatched opening bracket.';
    } else if (level === 2) {
      socraticQuestion = 'How could you keep the newest unmatched opening bracket easy to access?';
      hint = 'The last opening bracket seen should be the first one checked when a closer appears.';
      nextStep = 'Trace how your code adds an opener and removes it after a matching closer.';
    } else {
      socraticQuestion = 'What structure gives you the most recently added item first?';
      hint = 'A stack does this: it keeps items in order, and the latest item is the one you check first.';
      nextStep = 'Try using that idea to track unmatched openers, and also consider what it means if any remain at the end.';
    }
  } else if (/binary search|sorted array|sorted list/i.test(questionText)) {
    whatINoticed = noCode
      ? 'You have shared a search problem, but not your approach or code yet.'
      : 'Binary search depends on keeping the remaining search range correct after every comparison.';
    mistakeType = noCode ? 'Missing step' : 'Logical reasoning error';
    concept = 'A sorted list lets you rule out half of the remaining values after comparing with the middle.';
    if (noCode) {
      socraticQuestion = 'If the list is sorted, what could you learn by checking the middle value first?';
      hint = 'Try searching for a value in a short sorted list by hand.';
      nextStep = 'Describe how the range to search changes after each comparison.';
    } else if (level === 1) {
      socraticQuestion = 'After checking the middle value, how do you know which half can be ignored?';
      hint = 'Use whether the middle is too small or too large to choose the remaining side.';
      nextStep = 'Trace the left and right boundaries on a small sorted list.';
    } else if (level === 2) {
      socraticQuestion = 'When you discard one half, should the middle position remain in the next range?';
      hint = 'Check how your left and right boundaries move so the middle value is not checked forever.';
      nextStep = 'Try tracing a target that exists and one that is missing.';
    } else {
      socraticQuestion = 'What condition tells your loop to stop, and how should you calculate the middle index?';
      hint = 'Make sure the search range shrinks each time, including when only one position remains.';
      nextStep = 'Trace boundary updates for an empty range, a one-item range, and a target at either end.';
    }
  } else if (level === 2) {
    socraticQuestion = 'What information does your code need at this exact step, and where could it get it?';
    hint = 'Trace one small input and compare the value your code uses with the value you expected.';
    nextStep = 'Check the relevant condition or boundary using a small example.';
  } else if (level >= 3) {
    socraticQuestion = 'Which small piece of state or data structure would make this step easier to handle?';
    hint = 'Name what needs to be remembered, then choose a simple way to store it. You do not need to write the whole solution yet.';
    nextStep = 'Update one part of your approach and test it on a small input before changing the rest.';
  } else if (attemptText) {
    socraticQuestion = 'Which line or condition behaves differently from what you expect on a small example?';
    hint = 'Trace the code one step at a time and keep track of the variables.';
    nextStep = 'Try a normal case and an edge case, then compare the expected and actual behavior.';
  }

  return {
    correct: false,
    mistakeType,
    whatINoticed,
    socraticQuestion,
    hint,
    nextStep,
    concept,
    finalAnswer: '',
    whatChanged: '',
    whyItWorks: '',
    language: language || 'Not sure'
  };
}

function fallbackTutorResponse({ question, attempt, previousAttempt, newAttempt, hintLevel, problemType, language }) {
  const codingProblem = problemType === 'programming' || (problemType !== 'academic' && looksLikeProgramming(question, newAttempt || previousAttempt || attempt));
  if (codingProblem) {
    return fallbackProgrammingResponse({ question, attempt, previousAttempt, newAttempt, hintLevel, language });
  }

  const questionText = (question || '').trim();
  const attemptText = (newAttempt || previousAttempt || attempt || '').trim();
  const hintNumber = Math.min(Number(hintLevel) || 1, 3);

  if (attemptText && /2x\s*[+\-]\s*5\s*=\s*15|2\s*\*\s*x\s*[+\-]\s*5\s*=\s*15/i.test(questionText) && /2x\s*=\s*10/i.test(attemptText) && /x\s*=\s*5/i.test(attemptText)) {
    return {
      correct: true,
      mistakeType: 'Correct reasoning',
      whatINoticed: 'You isolated the variable correctly and kept the equation balanced.',
      socraticQuestion: 'What did you do to keep both sides equal?',
      hint: 'Your steps are consistent with the inverse operations needed to solve the equation.',
      nextStep: 'Check the value in the original equation to confirm it works.',
      concept: 'To solve equations, use inverse operations to isolate the variable while maintaining balance on both sides.',
      finalAnswer: 'x = 5',
      whatChanged: 'You correctly subtracted 5 from both sides and then divided by 2.',
      whyItWorks: 'Substituting x = 5 into 2x + 5 = 15 gives 10 + 5 = 15, which is true.'
    };
  }

  let mistakeType = 'Conceptual misunderstanding';
  let whatINoticed = 'Your work is not yet aligned with the goal of the problem.';
  let socraticQuestion = 'What does the equation ask you to do with the constant term?';
  let hint = 'Look at the operation that is currently undoing the relationship you want to preserve.';
  let nextStep = 'Try isolating the variable by reversing the most recent operation on both sides.';
  let concept = 'The goal is to keep the equation balanced by applying the same operation to both sides.';

  if (questionText && /equation|solve|x\s*[=]/i.test(questionText)) {
    mistakeType = 'Incorrect operation';
    whatINoticed = 'The work is changing the equation without keeping both sides balanced.';
    socraticQuestion = 'What operation cancels the +5 and keeps the equation balanced?';
    hint = 'Think about the inverse of addition. What happens if you subtract 5 from both sides?';
    nextStep = 'Apply the opposite operation to both sides, then simplify the equation.';
    concept = 'To isolate a variable, undo the operation attached to it while preserving equality.';
  }

  if (attemptText && /x\s*=\s*\d+/i.test(attemptText)) {
    whatINoticed = 'Your final step is close, but it should be checked against the original equation.';
    socraticQuestion = 'Can you test your result by substituting it back into the original equation?';
    hint = 'Substitute your value into the original equation and verify both sides match.';
    nextStep = 'Check whether the value actually satisfies the equation without changing the original structure.';
    concept = 'A solution is valid only if it makes the original equation true.';
  }

  if (hintNumber >= 2) {
    hint = 'Consider the inverse operation and apply it to both sides of the equation.';
  }

  if (hintNumber >= 3) {
    nextStep = 'Take the next algebraic step carefully. Replace the operation with its inverse and simplify each side.';
  }

  return {
    correct: false,
    mistakeType,
    whatINoticed,
    socraticQuestion,
    hint,
    nextStep,
    concept,
    finalAnswer: '',
    whatChanged: '',
    whyItWorks: ''
  };
}

async function getTutorResponse({ question, attempt, previousAttempt, newAttempt, hintLevel, problemType, language, imageDataUrl }) {
  const activeAttempt = newAttempt || previousAttempt || attempt || '';
  const programmingProblem = problemType === 'programming' || (problemType !== 'academic' && looksLikeProgramming(question, activeAttempt));
  const detectedLanguage = programmingProblem ? detectLanguage(activeAttempt, language) : '';
  const image = parseImageDataUrl(imageDataUrl);
  if (!openRouterApiKey) {
    console.error('AI request unavailable: OPENROUTER_API_KEY is not configured.');
    throw new Error('Socratic AI is not configured right now. Please try again later.');
  }

  try {
    const promptText = `Problem type: ${programmingProblem ? 'Programming' : 'Academic'}\nProgramming language (detected/selected): ${detectedLanguage || 'Not applicable'}\nProblem statement, exactly as submitted:\n${question || ''}\n\nStudent attempt:\n${attempt || ''}\n\nPrevious attempt:\n${previousAttempt || ''}\n\nNew attempt:\n${newAttempt || ''}\n\nCurrent assistance level: ${hintLevel || 1}\n${image ? '\nThe attached image is part of the submitted student work. Analyze the actual image together with the text. If it is unreadable, explicitly say so rather than guessing.' : ''}\n${programmingProblem && !activeAttempt.trim() ? '\nThe learner has provided no code or approach. Ask what they would do manually first. Do not provide an algorithm or solution.' : ''}`;
    const userContent = [{ type: 'text', text: promptText }];
    if (image) {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.data}` }
      });
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: 'system',
            content: programmingProblem
              ? `${BASE_SYSTEM_PROMPT}\n\n${PROGRAMMING_TUTOR_PROMPT}`
              : BASE_SYSTEM_PROMPT
          },
          { role: 'user', content: image ? userContent : promptText }
        ],
        temperature: 0.3,
        max_tokens: 700
      }),
      signal: AbortSignal.timeout(25000)
    });

    if (!response.ok) {
      const requestError = new Error(`OpenRouter request failed with HTTP ${response.status}`);
      requestError.statusCode = response.status;
      throw requestError;
    }

    const responseBody = await response.json();
    const responseContent = responseBody?.choices?.[0]?.message?.content;
    const rawText = typeof responseContent === 'string'
      ? responseContent
      : Array.isArray(responseContent)
        ? responseContent.map(part => typeof part?.text === 'string' ? part.text : '').join('')
        : '';
    const parsed = safeJsonParse(rawText);
    if (!parsed.correct) {
      parsed.finalAnswer = '';
    }
    if (programmingProblem) {
      parsed.language = detectedLanguage;
      if (!parsed.correct && /```|(?:public\s+static|def\s+\w+\s*\(|function\s+\w+\s*\()/i.test(`${parsed.hint}\n${parsed.nextStep}`)) {
        parsed.hint = 'Trace a small example and focus on the step where your result first differs from what you expect.';
        parsed.nextStep = 'Try changing that one idea yourself, then test it on the same example.';
      }
    }

    return parsed;
  } catch (error) {
    const status = getUpstreamStatus(error);
    console.error('OpenRouter request failed:', status ? `HTTP ${status}` : 'upstream error', `model=${OPENROUTER_MODEL}`, error.message || error);
    if (status === 429) {
      const rateLimitError = new Error('Socratic has reached OpenRouter’s request limit. Wait a little before trying again.');
      rateLimitError.statusCode = 429;
      throw rateLimitError;
    }
    if (status === 400 || status === 401 || status === 403) {
      const requestError = new Error(status === 401 || status === 403
        ? 'Socratic could not connect to its AI service. Please check the server configuration.'
        : 'The AI service could not accept this request. Please try again in a moment.');
      requestError.statusCode = 502;
      throw requestError;
    }
    if (image) {
      throw new Error('We couldn’t analyze the image with the AI service. Please try again later or type your work.');
    }
    throw new Error('The AI service could not analyze your work just now. Please try again in a moment.');
  }
}

function getUpstreamStatus(error) {
  const status = error && (error.status || error.statusCode || (error.cause && (error.cause.status || error.cause.statusCode)));
  if (status !== undefined && Number.isInteger(Number(status))) return Number(status);
  if (/\b429\b|too many requests|rate.?limit|quota exceeded/i.test(error && error.message || '')) return 429;
  if (/\b(400|401|403)\b|bad request|unauthorized|forbidden/i.test(error && error.message || '')) {
    const match = (error && error.message || '').match(/\b(400|401|403)\b/);
    return match ? Number(match[1]) : 400;
  }
  if (/\b(402|503)\b|payment required|service unavailable|high demand/i.test(error && error.message || '')) {
    const match = (error && error.message || '').match(/\b(402|503)\b/);
    return match ? Number(match[1]) : 503;
  }
  return 0;
}

function sendTutorError(res, error) {
  const status = getUpstreamStatus(error);
  const httpStatus = status === 429 ? 429 : status === 502 ? 502 : 503;
  const message = error && error.message
    ? error.message
    : 'Something went wrong while Socratic was thinking. Please try again.';

  if (httpStatus === 429) {
    res.set('Retry-After', '60');
  }
  return res.status(httpStatus).json({ success: false, message });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Socratic API is running.' });
});

app.post('/api/hint', async (req, res) => {
  const { question, attempt, previousAttempt, newAttempt, hintLevel, problemType, language, imageDataUrl } = req.body || {};

  if (!question || !question.trim()) {
    return res.status(400).json({ success: false, message: 'Please enter the question you are solving.' });
  }

  const currentWork = newAttempt || previousAttempt || attempt;
  const codingProblem = problemType === 'programming' || (problemType !== 'academic' && looksLikeProgramming(question, currentWork));
  if ((!attempt || !attempt.trim()) && !codingProblem && !imageDataUrl) {
    return res.status(400).json({ success: false, message: 'Please show the work you have tried.' });
  }

  try {
    const data = await getTutorResponse({
      question,
      attempt,
      previousAttempt,
      newAttempt,
      hintLevel: Math.max(1, Math.min(Number(hintLevel) || 1, 3)),
      problemType,
      language,
      imageDataUrl
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Hint request failed:', error.message || error);
    return sendTutorError(res, error);
  }
});

app.post('/api/recheck', async (req, res) => {
  const { question, attempt, previousAttempt, newAttempt, hintLevel, problemType, language, imageDataUrl } = req.body || {};

  if (!question || !question.trim()) {
    return res.status(400).json({ success: false, message: 'Please enter the question you are solving.' });
  }

  const codingProblem = problemType === 'programming' || (problemType !== 'academic' && looksLikeProgramming(question, newAttempt || previousAttempt || attempt));
  if ((!newAttempt || !newAttempt.trim()) && !codingProblem && !imageDataUrl) {
    return res.status(400).json({ success: false, message: 'Please enter your updated attempt.' });
  }

  try {
    const data = await getTutorResponse({
      question,
      attempt: attempt || previousAttempt,
      previousAttempt,
      newAttempt,
      hintLevel: Math.max(1, Math.min(Number(hintLevel) || 1, 3)),
      problemType,
      language,
      imageDataUrl
    });

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Recheck request failed:', error.message || error);
    return sendTutorError(res, error);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, () => {
  console.log(`Socratic server running at http://localhost:${PORT}`);
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Cannot start Socratic: port ${PORT} is already in use.`);
    console.error(`If Socratic is already open, use http://localhost:${PORT} without starting another copy.`);
    console.error('Otherwise, stop the process using that port or set a different PORT in .env.');
  } else {
    console.error('Could not start Socratic:', error.message || error);
  }
  process.exitCode = 1;
});
