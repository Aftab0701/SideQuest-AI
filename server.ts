import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import Tesseract from "tesseract.js";
import { LocalDb } from "./src/database/localDb";
import { AiService } from "./src/ai/aiService";
import { SearchService } from "./src/search/searchService";
import { TextExtractor } from "./src/importers/textExtractor";
import { 
  CapturedItem, 
  Mission, 
  SmartReminder, 
  ProductivityStats, 
  ChatConversation, 
  ChatMessage, 
  UserPreferences 
} from "./src/types";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

// Set maximum request body size for file/image uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

/**
 * Dynamic stats calculator based on the current database state
 */
function calculateProductivityStats(
  items: CapturedItem[], 
  missions: Mission[], 
  reminders: SmartReminder[]
): ProductivityStats {
  const processedCount = items.filter(i => i.processed).length;
  const totalTasks = missions.reduce((acc, m) => acc + (m.tasks ? m.tasks.length : 0), 0);
  const doneTasks = missions.reduce((acc, m) => acc + (m.tasks ? m.tasks.filter(t => t.status === "done").length : 0), 0);

  // Score base and dynamic calculation
  let score = 0;
  if (totalTasks > 0) {
    score = Math.round((doneTasks / totalTasks) * 60 + (processedCount / Math.max(1, items.length)) * 40);
  } else if (processedCount > 0) {
    score = Math.round((processedCount / items.length) * 40);
  }
  score = Math.max(0, Math.min(100, score));

  // Count active hidden intents across processed captures
  let unfinishedIntentsCount = 0;
  items.forEach(item => {
    if (item.processed && item.analysis?.hiddenIntents) {
      unfinishedIntentsCount += item.analysis.hiddenIntents.length;
    }
  });

  // Count tasks at risk
  let tasksAtRiskCount = 0;
  let activeUrgentReminders = reminders.filter(r => r.status === "active").length;

  missions.forEach(m => {
    if (m.tasks) {
      m.tasks.forEach(t => {
        if (t.status === "todo") {
          const todayStr = new Date().toISOString().split("T")[0];
          const isOverdueOrSoon = t.dueDate <= todayStr;
          if (t.priority === "urgent" || (t.priority === "high" && isOverdueOrSoon)) {
            tasksAtRiskCount++;
          }
        }
      });
    }
  });

  // Streak days simulation: if user has completed a task recently, maintain streak, otherwise 3
  const hasCompletedTasks = doneTasks > 0;
  const streakDays = hasCompletedTasks ? 6 : 0;

  return {
    score,
    streakDays,
    capturedCount: items.length,
    distilledCount: processedCount,
    completedMissionsCount: missions.filter(m => m.status === "completed").length,
    unfinishedIntentsCount,
    tasksAtRiskCount,
    urgencyNudgesCount: activeUrgentReminders + tasksAtRiskCount
  };
}

// ==========================================
// API ENDPOINTS
// ==========================================

// GET all workspace data
app.get("/api/data", (req, res) => {
  const db = LocalDb.read();
  const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
  res.json({
    capturedItems: db.capturedItems,
    missions: db.missions,
    reminders: db.reminders,
    conversations: db.conversations,
    preferences: db.preferences,
    searchHistory: db.searchHistory,
    stats
  });
});

// POST save user preferences
app.post("/api/preferences", (req, res) => {
  const { preferences } = req.body;
  if (!preferences) {
    return res.status(400).json({ error: "Missing preferences payload" });
  }
  LocalDb.write({ preferences });
  res.json({ success: true, preferences });
});

// POST capture messy item (with OCR / Text Extraction)
app.post("/api/capture", async (req, res) => {
  const { type, title, content, meta, fileName } = req.body;
  
  if (!type) {
    return res.status(400).json({ error: "Missing capture type" });
  }

  let finalContent = content || "";
  let extractedMeta = meta || {};

  // Server-side OCR trigger for images
  if (type === "image" && content && content.startsWith("data:image")) {
    try {
      console.log("Image received. Extracting text via local Tesseract OCR...");
      // Strip base64 prefix
      const base64Data = content.replace(/^data:image\/\w+;base64,/, "");
      const imageBuffer = Buffer.from(base64Data, "base64");
      
      const ocrResult = await Tesseract.recognize(imageBuffer, "eng");
      finalContent = ocrResult.data.text.trim();
      console.log("OCR success! Extracted text length:", finalContent.length);
      
      if (!finalContent) {
        finalContent = "[Empty screenshot / whiteboard with no readable printed text]";
      }
      extractedMeta = {
        ...extractedMeta,
        ocrProcessed: true,
        wordCount: finalContent.split(/\s+/).length
      };
    } catch (err) {
      console.error("Local Tesseract OCR failed:", err);
      finalContent = "[OCR text extraction failure - unreadable image format]";
    }
  } else {
    // Normal text extraction for text-based channels
    finalContent = TextExtractor.extract(type, title || "Untitled file", finalContent);
  }

  const db = LocalDb.read();
  const newItem: CapturedItem = {
    id: `cap-${Date.now()}`,
    createdAt: new Date().toISOString(),
    type,
    title: title || `Messy fragment (${type})`,
    content: finalContent,
    fileName,
    meta: extractedMeta,
    processed: false,
    analysis: null
  };

  db.capturedItems.unshift(newItem);
  LocalDb.write({ capturedItems: db.capturedItems });

  const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
  res.status(201).json({ item: newItem, stats });
});

// POST Analyze Capture (AI cognitive pipeline)
app.post("/api/analyze/:id", async (req, res) => {
  const { id } = req.params;
  const db = LocalDb.read();
  const item = db.capturedItems.find(i => i.id === id);

  if (!item) {
    return res.status(404).json({ error: "Captured item not found" });
  }

  try {
    // Run content analysis through selected AI model (Ollama / Gemini fallback)
    const analysis = await AiService.analyzeContent(
      item.content,
      item.type,
      item.title,
      db.preferences
    );

    // Apply analysis
    item.processed = true;
    item.analysis = analysis;

    // Generate Mission from tasks
    const newMission: Mission = {
      id: `mis-${Date.now()}`,
      title: `Mission: Distill ${item.title}`,
      description: analysis.summary,
      category: analysis.category,
      status: "active",
      tasks: analysis.tasks,
      hiddenIntentsCount: analysis.hiddenIntents.length,
      capturedItemIds: [item.id],
      productivityWeight: analysis.tasks.length * 10 + analysis.hiddenIntents.length * 5,
      createdAt: new Date().toISOString()
    };

    db.missions.unshift(newMission);

    // Sync reminders
    analysis.reminders.forEach(rem => {
      db.reminders.unshift({
        ...rem,
        missionId: newMission.id
      });
    });

    LocalDb.write({
      capturedItems: db.capturedItems,
      missions: db.missions,
      reminders: db.reminders
    });

    const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
    res.json({
      item,
      mission: newMission,
      reminders: db.reminders,
      stats
    });
  } catch (err: any) {
    console.error("AI pipeline failed:", err);
    res.status(500).json({ error: err.message || "Cognitive pipeline execution failed." });
  }
});

// POST toggle task status
app.post("/api/tasks/toggle", (req, res) => {
  const { missionId, taskId } = req.body;
  if (!taskId) {
    return res.status(400).json({ error: "Missing taskId" });
  }

  const db = LocalDb.read();

  db.missions = db.missions.map(m => {
    if (!missionId || m.id === missionId) {
      const updatedTasks = m.tasks.map(t => {
        if (t.id === taskId) {
          return { ...t, status: t.status === "todo" ? ("done" as const) : ("todo" as const) };
        }
        return t;
      });
      return { ...m, tasks: updatedTasks };
    }
    return m;
  });

  // Mirror status updates inside captured items
  db.capturedItems = db.capturedItems.map(item => {
    if (item.processed && item.analysis) {
      const updatedTasks = item.analysis.tasks.map(t => {
        if (t.id === taskId) {
          return { ...t, status: t.status === "todo" ? ("done" as const) : ("todo" as const) };
        }
        return t;
      });
      return { ...item, analysis: { ...item.analysis, tasks: updatedTasks } };
    }
    return item;
  });

  LocalDb.write({
    missions: db.missions,
    capturedItems: db.capturedItems
  });

  const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
  res.json({ success: true, missions: db.missions, stats });
});

// POST toggle mission complete
app.post("/api/missions/toggle", (req, res) => {
  const { missionId } = req.body;
  if (!missionId) {
    return res.status(400).json({ error: "Missing missionId" });
  }

  const db = LocalDb.read();
  db.missions = db.missions.map(m => {
    if (m.id === missionId) {
      const nextStatus = m.status === "completed" ? "active" : "completed";
      const updatedTasks = m.tasks.map(t => ({
        ...t,
        status: nextStatus === "completed" ? ("done" as const) : ("todo" as const)
      }));
      return { ...m, status: nextStatus, tasks: updatedTasks };
    }
    return m;
  });

  LocalDb.write({ missions: db.missions });
  const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
  res.json({ success: true, missions: db.missions, stats });
});

// POST snooze / complete reminders
app.post("/api/reminders/toggle", (req, res) => {
  const { reminderId, status } = req.body; // 'snoozed' | 'completed' | 'active'
  if (!reminderId) {
    return res.status(400).json({ error: "Missing reminderId" });
  }

  const db = LocalDb.read();
  db.reminders = db.reminders.map(r => {
    if (r.id === reminderId) {
      return { ...r, status: status || "completed" };
    }
    return r;
  });

  LocalDb.write({ reminders: db.reminders });
  const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
  res.json({ reminders: db.reminders, stats });
});

// POST merge overlapping captures
app.post("/api/merge", (req, res) => {
  const { sourceId, targetId } = req.body;
  const db = LocalDb.read();

  const sourceItem = db.capturedItems.find(i => i.id === sourceId);
  const targetItem = db.capturedItems.find(i => i.id === targetId);

  if (!sourceItem || !targetItem) {
    return res.status(404).json({ error: "One or both items not found" });
  }

  // Merge text content
  targetItem.content = `${targetItem.content}\n\n[Merged from Capture: ${sourceItem.title}]\n${sourceItem.content}`;
  targetItem.title = `${targetItem.title} + ${sourceItem.title}`;
  targetItem.processed = false;
  targetItem.analysis = null;

  // Remove source
  db.capturedItems = db.capturedItems.filter(i => i.id !== sourceId);
  LocalDb.write({ capturedItems: db.capturedItems });

  const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
  res.json({ capturedItems: db.capturedItems, stats });
});

// POST search documents semantically or by keywords
app.post("/api/search", async (req, res) => {
  const { query } = req.body;
  const db = LocalDb.read();

  if (query && !db.searchHistory.includes(query)) {
    db.searchHistory.unshift(query);
    if (db.searchHistory.length > 10) db.searchHistory.pop();
    LocalDb.write({ searchHistory: db.searchHistory });
  }

  const results = await SearchService.search(query, db.capturedItems, db.preferences);
  res.json({ results });
});

// POST local knowledge base chat (RAG)
app.post("/api/chat", async (req, res) => {
  const { conversationId, text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Missing query text" });
  }

  const db = LocalDb.read();
  
  // Find or construct conversation
  let conversation = db.conversations.find(c => c.id === conversationId);
  if (!conversation) {
    conversation = {
      id: conversationId || `chat-${Date.now()}`,
      title: text.substring(0, 30) + "...",
      messages: [],
      updatedAt: new Date().toISOString()
    };
    db.conversations.unshift(conversation);
  }

  // Construct context from user's fully processed database
  const processedItems = db.capturedItems.filter(i => i.processed);
  
  let kbContext = "";
  if (processedItems.length === 0) {
    kbContext = "The user has not imported or processed any documents yet. Encourage them to capture their first item.";
  } else {
    processedItems.forEach((item, idx) => {
      kbContext += `\n--- DOCUMENT #${idx + 1} (Title: ${item.title}, Category: ${item.analysis?.category || "Unknown"}) ---\n`;
      kbContext += `Summary: ${item.analysis?.summary || ""}\n`;
      kbContext += `Extracted Content:\n${item.content}\n`;
      if (item.analysis?.tasks) {
        kbContext += `Extracted Tasks: ${item.analysis.tasks.map(t => t.title).join(", ")}\n`;
      }
    });
  }

  // Add user query
  const userMsg: ChatMessage = {
    id: `msg-${Date.now()}-u`,
    sender: "user",
    text,
    createdAt: new Date().toISOString()
  };
  conversation.messages.push(userMsg);

  try {
    // Generate intelligent citation-grounded response
    const aiResponseText = await AiService.queryKnowledgeBase(
      text,
      kbContext,
      conversation.messages,
      db.preferences
    );

    // Format citations based on match
    const citedSources: { id: string; title: string }[] = [];
    processedItems.forEach(item => {
      const isCited = 
        aiResponseText.toLowerCase().includes(item.title.toLowerCase()) ||
        text.toLowerCase().includes(item.title.toLowerCase());
      if (isCited) {
        citedSources.push({ id: item.id, title: item.title });
      }
    });

    const aiMsg: ChatMessage = {
      id: `msg-${Date.now()}-ai`,
      sender: "ai",
      text: aiResponseText,
      createdAt: new Date().toISOString(),
      sources: citedSources.length > 0 ? citedSources : undefined
    };

    conversation.messages.push(aiMsg);
    conversation.updatedAt = new Date().toISOString();

    LocalDb.write({ conversations: db.conversations });
    res.json({ conversation });
  } catch (err: any) {
    console.error("Knowledge base query failed:", err);
    res.status(500).json({ error: err.message || "AI local search query failed." });
  }
});

// POST reset state (completely empty as per Production Requirements V2)
app.post("/api/reset", (req, res) => {
  LocalDb.clear();
  const db = LocalDb.read();
  const stats = calculateProductivityStats(db.capturedItems, db.missions, db.reminders);
  res.json({
    capturedItems: db.capturedItems,
    missions: db.missions,
    reminders: db.reminders,
    conversations: db.conversations,
    preferences: db.preferences,
    searchHistory: db.searchHistory,
    stats
  });
});

// ==========================================
// STATIC FILES & DEV SERVERS
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`SideQuest V2 Mobile Core active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
