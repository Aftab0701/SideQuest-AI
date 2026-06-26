# SideQuest AI

> Your notes remember what happened. SideQuest remembers what needs to happen next.

SideQuest AI is a mobile-first productivity application that helps people make sense of scattered information. Instead of asking users to manually organize their lives, it analyzes unstructured content—notes, screenshots, documents, voice recordings, emails, and more—to identify tasks, commitments, deadlines, and ideas that would otherwise be forgotten.

The goal isn't to create another AI chatbot or task manager. It's to bridge the gap between capturing information and actually acting on it.

---

## Why SideQuest?

Most productivity apps assume users already know what they need to do.

Reality is different.

Important commitments get buried inside meeting notes.

A startup idea is hidden in a random voice memo.

Someone asks for a follow-up in an email that never becomes a task.

A screenshot contains an event date that gets forgotten.

SideQuest AI is built to recover those hidden intentions automatically.

---

## What it does

* Imports information from multiple sources
* Extracts text from images and documents
* Understands context using AI
* Detects hidden tasks and commitments
* Finds deadlines and reminders
* Groups related work into missions
* Builds a searchable personal knowledge base
* Answers questions using your own data

---

## Features

### Universal Capture

Import information from:

* Notes
* PDFs
* Screenshots
* Images
* Voice recordings
* Documents
* Calendar exports
* Local files

---

### Intent Recovery

Instead of looking for explicit checklists, SideQuest identifies:

* Implied tasks
* Forgotten follow-ups
* Deadlines
* Commitments
* Ideas worth revisiting
* Risks
* Action items

---

### Mission Board

Related work is grouped into meaningful missions rather than isolated tasks.

Example:

**Hackathon**

* Prepare demo
* Finish README
* Review presentation
* Test deployment
* Record walkthrough

---

### AI Search

Ask questions naturally.

Examples:

> What deadlines do I have this week?

> Show everything related to the hackathon.

> What did Rahul ask me to do?

> Which startup ideas have I written recently?

---

### Local AI

SideQuest supports local inference through Ollama.

Supported models include:

* Llama 3.2
* Gemma
* Qwen
* Mistral
* Phi

The model can be changed without modifying the application.

---

## How it works

```text
Import Content
      │
      ▼
Text Extraction
      │
      ▼
OCR Processing
      │
      ▼
AI Understanding
      │
      ▼
Intent Detection
      │
      ▼
Task & Deadline Extraction
      │
      ▼
Mission Generation
      │
      ▼
Knowledge Base
      │
      ▼
Natural Language Search
```

---

## Tech Stack

### Frontend

* Flutter
* Material 3
* Responsive Mobile UI

### Backend

* FastAPI
* Python

### AI

* Ollama
* Local LLMs
* Structured JSON Output

### Storage

* SQLite
* Local Knowledge Store

---

## Design Principles

* Mobile-first
* Offline-first
* Privacy-first
* Minimal UI
* Fast interactions
* No unnecessary complexity

The interface focuses on helping users get things done instead of overwhelming them with dashboards and widgets.

---

## Example Workflow

Upload a screenshot from a meeting.

↓

OCR extracts the text.

↓

AI understands the discussion.

↓

Tasks are identified.

↓

Deadlines are detected.

↓

Related information is linked together.

↓

A mission is created automatically.

↓

You receive actionable next steps instead of another note.

---

## Roadmap

* Voice conversation support
* Calendar synchronization
* Email integration
* Cross-device sync
* Semantic document search
* Collaborative workspaces
* Smart reminders
* AI-generated weekly review

---

## Project Status

Currently under active development.

The focus is on building a reliable AI execution assistant that works with real user data instead of mock datasets.

---

## Philosophy

Most apps store information.

SideQuest is designed to help you finish what you started.
