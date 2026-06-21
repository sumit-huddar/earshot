const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Each mode tailors the summary structure to the type of audio captured.
const MODES = {
  meeting: {
    role: 'expert meeting summarizer',
    label: 'meeting',
    sections: `1. **Overview** — 2-3 sentences on what the meeting covered.
2. **Key Discussion Points** — bullet points of the main topics.
3. **Decisions Made** — conclusions reached (write "None recorded" if none).
4. **Action Items** — tasks with the person responsible if mentioned (write "None recorded" if none).
5. **Next Steps** — follow-ups or deadlines mentioned (write "None recorded" if none).`,
  },
  lecture: {
    role: 'expert academic note-taker',
    label: 'lecture',
    sections: `1. **Topic Overview** — 2-3 sentences on what the lecture covered.
2. **Key Concepts** — the main ideas explained, each with a one-line definition.
3. **Important Details & Examples** — supporting facts, formulas, or examples given.
4. **Things to Review** — anything flagged as important for an exam or assignment.
5. **Study Questions** — 3-5 questions a student should be able to answer afterward.`,
  },
  podcast: {
    role: 'sharp content summarizer',
    label: 'podcast or video',
    sections: `1. **Episode Overview** — 2-3 sentences on what was discussed.
2. **Main Takeaways** — the most valuable insights as bullet points.
3. **Notable Quotes or Moments** — memorable statements (paraphrase if unclear).
4. **People, Tools & References** — any names, books, products, or links mentioned.
5. **Worth Exploring Further** — topics the listener might want to look into.`,
  },
  interview: {
    role: 'professional interview analyst',
    label: 'interview',
    sections: `1. **Overview** — 2-3 sentences on the interview's context and focus.
2. **Key Questions & Answers** — the most important exchanges, summarized.
3. **Strengths / Highlights** — notable positive points raised.
4. **Concerns / Follow-ups** — anything unresolved or worth probing further.
5. **Overall Impression** — a brief closing assessment.`,
  },
};

function getMode(mode) {
  return MODES[mode] || MODES.meeting;
}

async function summarizeMeeting(transcripts, title = 'Session', mode = 'meeting') {
  const m = getMode(mode);

  const fullText = (Array.isArray(transcripts) && transcripts.length > 0)
    ? transcripts.map(t => `[${t.timestamp}] ${t.text}`).join('\n')
    : 'No transcript available.';

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'user',
        content: `You are an ${m.role}. Below is the transcript of "${title}" (a ${m.label}).

TRANSCRIPT:
${fullText}

Write a clean, structured summary in Markdown with these sections:
${m.sections}

The transcript comes from automatic speech recognition, so it may contain small errors — infer intent where reasonable. If the transcript is genuinely empty or has no meaningful content, briefly say that nothing substantive was captured.`,
      },
    ],
  });

  return completion.choices[0].message.content;
}

/**
 * Answer a question using the most relevant past summaries (RAG).
 * `matches` is an array of { title, summary, createdAt, _score }.
 */
async function answerFromHistory(question, matches) {
  if (!matches.length) {
    return "I couldn't find anything relevant in your saved sessions yet.";
  }

  const context = matches.map((m, i) => {
    const when = m.startTime || m.createdAt;
    const date = when ? new Date(when).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'unknown date';
    return `[Source ${i + 1}] "${m.title}" (${date}):\n${m.summary}`;
  }).join('\n\n---\n\n');

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'user',
        content: `You are a helpful assistant with access to the user's past meeting/session summaries. Answer their question using ONLY the sources below. Cite the source by its title when you use it (e.g., *from "Roadmap Sync"*). If the sources don't contain the answer, say so honestly.

SOURCES:
${context}

QUESTION: ${question}

Answer concisely in Markdown.`,
      },
    ],
  });

  return completion.choices[0].message.content;
}

module.exports = { summarizeMeeting, answerFromHistory, MODES };
