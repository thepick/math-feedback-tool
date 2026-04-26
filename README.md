# Math Feedback Tool

AI-powered grading for 5th grade math worksheets. Upload a photo of a completed worksheet and the tool automatically detects questions, assigns complexity-based point values, and grades each answer with partial credit.

## Features

- **Auto Question Detection** — Upload a photo and the AI identifies every question on the worksheet, assigns a complexity score (1-5), and determines the math topic
- **Partial Credit Grading** — Each answer is graded from 0 to its max points, with partial credit for reasonable attempts with minor errors
- **5-Category Rubric** — Neatness, Mathematical Vocabulary, Core Math Competencies, Math Communication, and Problem-Solving Skills with auto-adjusting weights
- **Corrected Math with Steps** — Shows the correct answer for every problem with step-by-step work shown
- **Print to Notebook** — Generate a clean A5 notebook summary with scores, feedback, and corrected math
- **Student Portfolio** — Track progress over time with Chart.js graphs for each student
- **Google Drive Sync** — OAuth sign-in to automatically back up rosters, settings, and portfolio data
- **Photo Crop & Rearrange** — Drag to crop worksheet photos and reorder them before grading
- **Single-File HTML** — No build step, no dependencies beyond a CDN chart library. Deploy to GitHub Pages in one click

## Setup

1. Get a free API key from [OpenRouter](https://openrouter.ai/keys)
2. Open `index.html` in a browser
3. Click the gear icon and paste your API key
4. (Optional) Set up a Google OAuth Client ID for Drive sync — see [Google Cloud Console](https://console.cloud.google.com/apis/credentials)

## Models

The default model is `google/gemini-3.1-flash-lite-preview`. Two fallback options are available in Settings:
- `google/gemini-2.5-flash`
- `anthropic/claude-3.5-haiku`

All models support vision for analyzing worksheet photos.

## Tech

Vanilla HTML/CSS/JavaScript. Zero framework, zero build step. The only external dependency is Chart.js loaded from CDN for portfolio graphs.

## License

MIT
