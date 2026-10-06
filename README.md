# Socratic — A Tutor That Won’t Give You the Answer

## Problem
AI tools often give students answers instead of helping them understand their mistakes.

## Solution
Socratic reviews a learner's work and helps them discover the next step with adaptive, beginner-friendly guidance instead of immediately giving the solution. One flow supports academic questions, programming problems, code, handwritten work, and diagrams.

## Features
- AI reasoning analysis
- Mistake detection
- Socratic questions
- Progressive hints
- Re-attempt and re-check loop
- Three adaptive assistance levels
- Handwritten image and diagram analysis
- Programming and LeetCode reasoning support
- Responsive UI

## Tech stack
- HTML
- CSS
- JavaScript
- Node.js
- Express
- Google Gemini/Gemma API

## Setup
1. Install dependencies:
   npm install
2. Create a .env file with your Gemini API key:
   GEMINI_API_KEY=YOUR_API_KEY_HERE
   PORT=3001
   # Optional; defaults to a Gemini model that supports text and image analysis.
   GEMINI_MODEL=gemini-2.5-flash
3. Start the app:
   npm start
4. Open:
   http://localhost:3001

## Notes
The learning loop stays at the center: question, work, guidance, retry, feedback, and success. Images must be PNG, JPG, or WebP and no larger than 3 MB.

If startup says port 3001 is already in use, Socratic may already be running; open http://localhost:3001 instead of starting another copy. If Gemini returns a request-limit message, wait and retry. If it continues, check the API key's Gemini quota and billing.
