# ProactiveAI 🤖

> **Your Intelligent Notion Task Agent** — manage your Notion tasks using natural language, powered by Qwen 3 via Groq.

ProactiveAI is a Next.js web app that lets you interact with your Notion task database through a conversational command interface. Instead of opening Notion manually, just type what you want — create tasks, check deadlines, update statuses, delete tasks, or ask the AI to prioritize your workload for you. 

It also features **Focus Horizon**, an AI-driven project roadmap generator that analyzes your real-world capacity to sequence and schedule your long-term goals intelligently.

---

## ✨ Features

- **Natural Language Commands** — Type commands like *"Add a task to submit thesis by tomorrow"* or *"Mark the API integration task as done"*
- **Full CRUD on Notion** — Create, read, update, and delete tasks directly in your Notion database
- **Multi-Database Support** — Connect multiple databases; the AI automatically infers and routes tasks to the most logical Notion database.
- **AI-Powered Prioritization** — Ask *"Which task should I prioritize next?"* and get a reasoned, confidence-scored suggestion based on deadlines and status
- **Focus Horizon (Strategic Planning)** — Describe a large project or goal. The AI analyzes your existing workload and generates a sequenced day-by-day roadmap, ensuring you never exceed a 10-hour workload hard cap.
- **Smart Task Matching** — Fuzzy intent matching handles typos, filler words, and partial task names; returns `UNCLEAR` instead of making wrong edits
- **Timezone-Aware Scheduling** — Dates like "tomorrow", "next Friday", or "at 3pm" are resolved mathematically using your local timezone
- **Rate Limit Resilience** — Intelligent caching and fingerprinting minimizes API calls. If Groq rate limits are hit, the UI gracefully enters a cooldown state while preserving memory.
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
| Testing | [Jest](https://jestjs.io/) & ts-jest |
| Icons | [Lucide React](https://lucide.dev/) |
| Package Manager | pnpm |

---

## 📁 Project Structure

```
src/
├── app/
│   ├── actions/
│   │   ├── assistant-actions.ts # LLM orchestration — intent parsing, suggestions, routing
│   │   ├── horizon-actions.ts   # Project roadmap generation & scheduling logic
│   │   ├── strategy-actions.ts  # Capacity insights, rate limiting, and workload capping
│   │   └── notion-actions.ts    # Notion API calls (fetch, create, update, batch deploy)
│   ├── dashboard/             
│   │   └── horizon/             # Horizon roadmap planning page
│   ├── page.tsx                 # Root dashboard page — renders the CommandInput UI
│   ├── layout.tsx               # App layout and metadata
│   └── globals.css              # Global styles
├── components/
│   ├── CommandInput.tsx         # Main chat-style command interface component
│   ├── HorizonView.tsx          # Focus Horizon interactive timeline and deployment UI
│   ├── StrategyView.tsx         # Capacity and insights visualization panel
│   └── Sidebar.tsx              # Application navigation sidebar
├── lib/
│   ├── groq.ts                  # Groq client + shared model constant (GROQ_MODEL)
│   ├── notion.ts                # Notion client + raw database query helper
│   └── utils.ts                 # Timezone math, JSON extraction, string normalizers
└── __tests__/                   # Jest automated test suites
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
- A [Groq API Key](https://console.groq.com/)
- A [Notion Integration Token](https://www.notion.so/my-integrations) with access to your task database(s)

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
```

### 4. Configure your Notion Database

Your Notion database must have the following properties:

| Property | Type |
|---|---|
| `Name` | Title |
| `Status` | Status (`Not started`, `In Progress`, `Done`) |
| `Date` | Date |

Make sure your integration has been **shared** with the database (open the database → Share → Invite your integration). The system will automatically discover all databases your integration has access to.

### 5. Run the development server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 💬 Usage Examples

### Assistant

| What you type | What happens |
|---|---|
| `List all my current tasks.` | Fetches and displays all tasks from Notion |
| `Add a task to buy groceries by Friday.` | Creates a new Notion task with a due date |
| `Add a task to call dentist at 3pm today.` | Creates a task with a specific time in your timezone |
| `Mark submit thesis as done.` | Updates the task status to `Done` |
| `Delete the buy groceries task.` | Archives the task in Notion |
| `Which task should I prioritize next?` | Returns an AI-reasoned suggestion with priority and confidence score |

### Focus Horizon

1. Navigate to the **Horizon** tab.
2. Enter a goal: *"Draft a plan to launch my portfolio website within 2 weeks"*
3. The AI scans your existing Notion tasks, calculates daily workload capacity, and generates a sequenced timeline of tasks that fit into your available hours.
4. Click **"Deploy Blueprint to Notion"** to batch-export the roadmap directly into your Target Database.

---

## 🧪 Testing

The project uses Jest for unit testing core logic (timezone offsets, JSON extraction, status normalizers, Notion sorting logic, etc.).

```bash
pnpm test
# OR
pnpm test:watch
```

---

## 🧠 How It Works

```
User Prompt
    │
    ▼
┌─────────────────────────────┐
│   processUserPrompt()       │  ← LLM classifies intent into:
│   (Qwen 3 32B via Groq)     │    CREATE / READ / UPDATE / DELETE
└────────────┬────────────────┘    SUGGEST / PLAN / UNCLEAR / OTHER
             │
             ▼
┌────────────────────────────────────────────┐
│             performNotionCRUD()            │
│                                            │
│  CREATE  →  createNotionTask()             │
│  READ    →  fetchNotionTasks()             │
│  UPDATE  →  updateNotionTask()             │
│  DELETE  →  deleteNotionTask() (archive)   │
│  SUGGEST →  getAgentSuggestion()  (LLM)    │
│  PLAN    →  Navigate to HorizonView        │
│  UNCLEAR →  Ask user to clarify            │
│  OTHER   →  Deflect gracefully             │
└────────────────────────────────────────────┘
             │
             ▼
      Response shown in UI
```

The LLM outputs **strict JSON** for all decisions, ensuring reliable parsing without fragile string manipulation. Intelligent caching ensures that repeated requests to calculate capacity or prioritize tasks only trigger API calls when Notion state changes.

---

## ⚙️ Configuration

The active LLM model can be configured dynamically directly from the UI:

1. Click on the **Settings (Brain icon)** in the top right of the dashboard.
2. Select your preferred model from the dropdown (e.g., `qwen/qwen3-32b`, `llama-3.3-70b-versatile`, `mixtral-8x7b-32768`).
3. The app automatically fetches the latest available models from Groq and saves your selection securely in a cookie.

*(If no cookie is set, it safely defaults to `qwen/qwen3-32b` or the first available fallback model).*

---

## 📄 License

This project is for personal/educational use. Feel free to fork and adapt it for your own needs.
