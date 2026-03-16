# ProactiveAI 🤖

> **Your Intelligent Notion Task Agent** — manage your Notion tasks using natural language, powered by Qwen 3 via Groq.

ProactiveAI is a Next.js web app that lets you interact with your Notion task database through a conversational command interface. Instead of opening Notion manually, just type what you want — create tasks, check deadlines, update statuses, delete tasks, or ask the AI to prioritize your workload for you.

---

## ✨ Features

- **Natural Language Commands** — Type commands like *"Add a task to submit thesis by tomorrow"* or *"Mark the API integration task as done"*
- **Full CRUD on Notion** — Create, read, update, and delete tasks directly in your Notion database
- **AI-Powered Prioritization** — Ask *"Which task should I prioritize next?"* and get a reasoned, confidence-scored suggestion based on deadlines and status
- **Smart Task Matching** — Fuzzy intent matching handles typos, filler words, and partial task names; returns `UNCLEAR` instead of making wrong edits
- **Timezone-Aware Scheduling** — Dates like "tomorrow", "next Friday", or "at 3pm" are resolved mathematically using your local timezone
- **Prompt Suggestions** — Built-in suggestion panel with one-click example prompts to get started fast
- **Out-of-Scope Guard** — Non-task questions (e.g. "what's the weather?") are gracefully deflected

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org/) (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| LLM | [Qwen 3 32B](https://huggingface.co/Qwen/Qwen3-32B) via [Groq](https://groq.com/) |
| Task Database | [Notion API](https://developers.notion.com/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Package Manager | pnpm |

---

## 📁 Project Structure

```
src/
├── app/
│   ├── actions/
│   │   ├── agent-actions.ts   # LLM orchestration — intent parsing, suggestions, CRUD dispatch
│   │   └── notion-actions.ts  # Notion API calls — fetch, create, update, delete (archive)
│   ├── api/
│   │   ├── agent/             # REST endpoint for agent processing
│   │   └── notion/            # REST endpoint for Notion operations
│   ├── page.tsx               # Root page — renders the CommandInput UI
│   ├── layout.tsx             # App layout and metadata
│   └── globals.css            # Global styles
├── components/
│   └── CommandInput.tsx       # Main chat-style command interface component
└── lib/
    ├── groq.ts                # Groq client + shared model constant (GROQ_MODEL)
    └── notion.ts              # Notion client + raw database query helper
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- A [Groq API Key](https://console.groq.com/)
- A [Notion Integration Token](https://www.notion.so/my-integrations) with access to your task database

### 1. Clone the repository

```bash
git clone https://github.com/sandilavi/Proactive-AI
cd Proactive-AI
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up environment variables

Create a `.env.local` file in the root of the project:

```env
GROQ_API_KEY=your_groq_api_key_here
NOTION_TOKEN=your_notion_integration_token_here
NOTION_DATABASE_ID=your_notion_database_id_here
```

> **How to get your Notion Database ID:**
> Open your Notion database in the browser. The URL looks like:
> `https://www.notion.so/yourworkspace/{DATABASE_ID}?v=...`
> Copy the `DATABASE_ID` part (the 32-character string before `?v=`).

### 4. Configure your Notion Database

Your Notion database must have the following properties:

| Property | Type |
|---|---|
| `Name` | Title |
| `Status` | Status (`Not started`, `In Progress`, `Done`) |
| `Date` | Date |

Make sure your integration has been **shared** with the database (open the database → Share → Invite your integration).

### 5. Run the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 💬 Usage Examples

| What you type | What happens |
|---|---|
| `List all my current tasks.` | Fetches and displays all tasks from Notion |
| `Add a task to buy groceries by Friday.` | Creates a new Notion task with a due date |
| `Add a task to call dentist at 3pm today.` | Creates a task with a specific time in your timezone |
| `Mark submit thesis as done.` | Updates the task status to `Done` |
| `Delete the buy groceries task.` | Archives the task in Notion |
| `Which task should I prioritize next?` | Returns an AI-reasoned suggestion with priority and confidence score |

---

## 🧠 How It Works

```
User Prompt
    │
    ▼
┌─────────────────────────────┐
│   processUserPrompt()       │  ← LLM classifies intent into:
│   (Qwen 3 32B via Groq)     │    CREATE / READ / UPDATE / DELETE
└────────────┬────────────────┘    SUGGEST / UNCLEAR / OTHER
             │
             ▼
┌────────────────────────────────────────────┐
│             performNotionCRUD()            │
│                                            │
│  CREATE  →  createNotionTask()             │
│  READ    →  fetchNotionTasks()             │
│  UPDATE  →  updateNotionTask()             │
│  DELETE  →  deleteNotionTask() (archive)   │
│  SUGGEST →  getAgentSuggestion()  (LLM)   │
│  UNCLEAR →  Ask user to clarify            │
│  OTHER   →  Deflect gracefully             │
└────────────────────────────────────────────┘
             │
             ▼
      Response shown in UI
```

The LLM outputs **strict JSON** for all decisions, ensuring reliable parsing without fragile string manipulation.

---

## ⚙️ Configuration

The active LLM model is defined in a single place:

```ts
// src/lib/groq.ts
export const GROQ_MODEL = "qwen/qwen3-32b";
```

To switch models (e.g., to `llama-3.3-70b-versatile`), update this one constant and it propagates everywhere automatically.

---

## 📄 License

This project is for personal/educational use. Feel free to fork and adapt it for your own needs.
