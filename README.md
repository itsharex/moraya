# Moraya — The Elegantly Minimal Markdown AI Agent for the Local AI Era

**Moraya** is a free, open-source, ultra-lightweight (\~10MB) WYSIWYG Markdown editor built with Rust + Tauri v2. Inspired by minimalist seamless editing, it delivers an elegant writing experience while integrating **the most advanced local AI ecosystem and MCP (Model Context Protocol) capabilities** — turning your editor into a powerful, privacy-first AI agent platform.

> **mora** (Latin: "a moment") + **ya** (Chinese: "elegance") = **Moraya**  
> Privacy-first • Fully local • Infinitely extensible AI

![](https://raw.githubusercontent.com/zouwei/resource/master/images/moraya/20260302-184554.-image.png)

![](https://raw.githubusercontent.com/zouwei/resource/master/images/moraya/20260302-185211.-image.png)

![](https://raw.githubusercontent.com/zouwei/resource/master/images/moraya/20260303-131729.-image.png)

![](https://raw.githubusercontent.com/zouwei/resource/master/images/moraya/20260214-165329.-image.png)

![](https://raw.githubusercontent.com/zouwei/resource/master/images/moraya/20260223-014749.-image.png)

![](https://raw.githubusercontent.com/zouwei/resource/master/images/moraya/20260223-015339.-image.png)

**[User Manual / Wiki](https://github.com/zouwei/moraya/wiki)**

## Why Moraya? Key Advantages

- **Ultra-Lightweight & Native Performance** — \~10MB installer, instant launch, tiny memory footprint.
- **True Instant WYSIWYG** — Type `# `                                     and see a heading instantly (Milkdown/ProseMirror-powered).
- **Most Powerful Local AI Integration** — Multi-provider streaming chat (Claude, OpenAI, Gemini, DeepSeek, Ollama, custom endpoints), 71+ AI templates across 10 categories, AI image generation, and smart writing commands.
- **Leading MCP Ecosystem** — Dynamic MCP container, one-click Marketplace (Official, LobeHub, Smithery), autonomous local AI services, tool calling, and custom agent workflows — all fully self-hosted.
- **Complete Modern Workflow** — Visual/Source/Split modes, publishing tools, SEO assistant, AI images, and automatic RSS feeds.
- **Security by Design** — API keys stored in OS Keychain, all API calls proxied through Rust backend, CSP enforcement, path traversal protection. Everything can run offline with local models; your data never leaves your machine.

## Features

### Editor

- **Three Editor Modes** — Visual (WYSIWYG), Source (raw Markdown), Split (synced side-by-side with block-level scroll anchoring). Toggle with `Cmd+/` or `Ctrl+/`.
- **Full Markdown Support** — CommonMark + GFM extensions: tables with floating toolbar, task lists, strikethrough, emoji, definition lists.
- **Math Rendering** — Inline and block LaTeX via KaTeX.
- **Code Blocks** — Syntax highlighting, language selector dropdown (25+ languages), one-click copy, hover toolbar.
- **Mermaid Diagrams** — 9 diagram types (flowchart, sequence, gantt, state, class, ER, pie, mindmap, journey) with edit/preview dual mode, lazy-loaded rendering (\~1.2MB loaded only on first use), and automatic theme adaptation.
- **Image Tools** — Floating toolbar for resizing, right-click context menu, drag-and-drop.
- **Sidebar File Explorer** — Directory memory across sessions, real-time file refresh, list/tree dual views, right-click context menu (new, rename, delete), and full-text file search across the open folder.
- **Find & Replace** — Full-text search and replace within documents.

### AI-Powered Writing

- **Multi-Provider Support** — Claude, OpenAI, Gemini, DeepSeek, Grok, Mistral, GLM, MiniMax, Doubao, Ollama, and any OpenAI-compatible endpoint. Multi-model configuration with active/inactive switching.
- **71+ AI Templates** — 10 categories (Writing, Translation, Student, Kids, Marketing, Professional, Personal, Chinese Games, English Games, Quiz) with 5 flow types (auto, input, selection, parameterized, interactive).
- **Streaming Chat Panel** — Real-time AI responses with insert/replace/copy actions.
- **Vision / Multimodal Input** — Paste, drag-and-drop, or pick images to include in AI conversations. Auto-compression for oversized images; thumbnail preview with lightbox viewer. Compatible with Claude, OpenAI, Gemini, and Ollama vision models.
- **AI + MCP Tool Integration** — LLM can call MCP tools with auto-retry loop, enabling autonomous AI workflows.
- **AI Image Generation** — 5 modes (article, design, storyboard, product, moodboard) × 10 styles each, with 7 aspect ratios and 3 resolution levels. Supports OpenAI DALL-E, Grok, Gemini Imagen, Qwen, Doubao, and custom providers.

### AI Voice Transcription

- **Real-Time Speech-to-Text** — Stream microphone audio to Deepgram, Gladia, AssemblyAI, or Azure Speech Services with sub-second transcription latency.
- **Speaker Diarization** — Automatically distinguish and label multiple speakers per session using pitch-based gender detection, with support for custom naming.
- **Voiceprint Archive** — Cross-session speaker recognition via stored voice profiles; sample audio is captured automatically during recording and capped at 30 seconds per profile.
- **Transcription Panel** — Color-coded per-speaker segments, one-click AI meeting summary generation, and Markdown export directly into the editor.
- **Voice Settings** — Per-provider key management via OS Keychain, test-connection verification, and voice profile CRUD with playback preview.

### MCP Ecosystem

- **Three Transports** — stdio, SSE, and HTTP for maximum compatibility.
- **Marketplace** — Browse and one-click install MCP servers from 3 data sources (Official Registry, LobeHub, Smithery).
- **Dynamic MCP Container** — AI can create MCP services on-the-fly with a lightweight Node.js runtime. 4 internal tools: create, save, list, and remove services.
- **Built-in Presets** — Filesystem, Fetch, Git, Memory one-click setup.
- **Claude Desktop JSON Import** — Paste `mcpServers` JSON config to auto-add servers.
- **Knowledge Base** — Multi-knowledge-base management with quick-switch dropdown and per-KB AI behavior rules via `MORAYA.md` (automatically injected into AI context). Sync KB content with MCP servers for context-aware AI.

### Publishing Workflow

- **Multi-Target Publishing** — Publish to GitHub repos and custom APIs with front matter and file naming templates.
- **SEO Assistant** — AI-generated titles, excerpts, tags, slug, and meta descriptions.
- **Image Hosting** — Auto-upload to SM.MS, Imgur, GitHub, Qiniu Kodo, Aliyun OSS, Tencent COS, AWS S3, Google GCS, or custom providers. HMAC request signing for object storage handled in Rust backend.
- **RSS Feed** — Auto-update RSS 2.0 feed on publish (zero-dependency XML generation).

### Plugin System

- **Decentralized Registry** — GitHub-based open registry; no central server required. Community plugins hosted and distributed as standard GitHub repositories.
- **Plugin API v1** — Hook into editor commands, AI chat, AI image generation, and voice transcription workflows via a versioned JavaScript API.
- **Marketplace** — Browse, install, and update plugins with one-click install, real-time GitHub release data, and zero-configuration setup.
- **Supply Chain Security** — SHA256 version pinning and per-plugin permission model; plugins declare required capabilities upfront.

### Security

- **OS Keychain Storage** — API keys stored in native secure storage (macOS Keychain, Windows Credential Manager, Linux Secret Service). The OS may prompt for your system password when Moraya first accesses the Keychain — this is the operating system verifying your identity before granting access to securely stored credentials, not Moraya itself requesting a password.
- **Rust AI Proxy** — All external API calls routed through Rust backend; keys never exposed in WebView.
- **CSP Enforcement** — `script-src 'self'`, `connect-src` locked to IPC and localhost.
- **MCP Hardening** — Command validation, startup confirmation dialogs, environment variable filtering, zombie process prevention, buffer limits.
- **Path Traversal Protection** — All file operations validate and canonicalize paths.
- **HTML Export Sanitization** — DOMParser-based XSS prevention on export.

### Privacy

- **Bring Your Own Key (BYOK)** — You provide your own API keys. Keys are stored exclusively in your OS's native secure storage (macOS Keychain / Windows Credential Manager / Linux Secret Service), encrypted at rest, and never transmitted to any Moraya server.
- **No Intermediary Servers** — AI prompts and content are sent **directly from your device** to the provider's API. Moraya does not operate any relay or proxy servers — the data path is simply: Your Device → Provider API. Authentication is injected on-device by the local Rust backend before any request leaves your machine.
- **Full Privacy Policy** — Available in-app via Help → Privacy Policy, or at [privacy-policy.md](src-tauri/resources/privacy-policy.md).

### Platform & UI

- **Cross-Platform** — macOS, Windows, Linux, and iPadOS via Tauri v2. iPad builds distributed via TestFlight with Tab bar multi-file editing, floating touch toolbar, and Magic Keyboard shortcut support.
- **Frameless Window** — Custom title bar with native macOS traffic lights.
- **Multi-Window** — Multiple editor windows with macOS Dock right-click menu support.
- **Auto-Update** — Silent daily update checks with one-click install.
- **Native Menus & Shortcuts** — Full platform-native menus (File, Edit, Paragraph, Format, View, Help).
- **Themes** — Light, Dark, and system-sync modes.
- **Internationalization** — English & Simplified Chinese with auto-detection.
- **Export** — HTML and LaTeX built-in; PDF/DOCX/EPUB via future pandoc integration.

## Architecture Overview

```text
┌────────────────────────────────────────────────────────┐
│              Tauri WebView (Frontend)                  │
│        Svelte 5 + ProseMirror + TypeScript             │
│                                                        │
│  ┌───────────┐ ┌───────┐ ┌──────────┐ ┌───────────┐    │
│  │  Editor   │ │  AI   │ │ Settings │ │  Voice /  │    │
│  │ProseMirror│ │ Panel │ │  Panel   │ │  Publish  │    │
│  │ + Source  │ │       │ │ (9 tabs) │ │  Plugin   │    │
│  └─────┬─────┘ └──┬────┘ └────┬─────┘ └────┬──────┘    │
│        │          │           │            │           │
│  ┌─────┴──────────┴───────────┴────────────┴───────┐   │
│  │              Services & Stores                  │   │
│  │  (file, AI, MCP, voice, publish, plugin, i18n)  │   │
│  └───────────────────┬─────────────────────────────┘   │
│                      │ Tauri IPC (invoke)              │
└──────────────────────┼─────────────────────────────────┘
                       │
┌──────────────────────┼─────────────────────────────────┐
│              Rust Backend (Tauri)                      │
│                                                        │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐   │
│  │ File I/O│ │ AI Proxy │ │ MCP Proc │ │  Speech   │   │
│  │Commands │ │ HTTP/SSE │ │ Manager  │ │  Proxy    │   │
│  └─────────┘ └──────────┘ └──────────┘ └───────────┘   │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐   │
│  │Keychain │ │  Object  │ │  Plugin  │ │   Menu    │   │
│  │(keyring)│ │ Storage  │ │ Manager  │ │           │   │
│  └─────────┘ └──────────┘ └──────────┘ └───────────┘   │
└────────────────────────────────────────────────────────┘
```

## Tech Stack

## Install

### macOS (Homebrew)

```bash
brew tap zouwei/moraya
brew install --cask moraya
```

Upgrade: `brew upgrade --cask moraya` · Uninstall: `brew uninstall --cask moraya`

### All Platforms

Download the latest release from [GitHub Releases](https://github.com/zouwei/moraya/releases).

> **macOS note**: The app is not code-signed. If you see *"Moraya is damaged and can't be opened"*, run this in Terminal:
>
> ```bash  
> xattr -cr /Applications/Moraya.app  
> ```
>
> Then open the app again.

## Getting Started

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Node.js](https://nodejs.org/) (>=18)
- [pnpm](https://pnpm.io/) (v10.x)
- Tauri v2 system dependencies — see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install dependencies
pnpm install

# Start dev server with hot reload
pnpm tauri dev

# Frontend only (no Tauri shell)
pnpm dev
```

### Build

```bash
# Full production build (frontend + Rust + bundle)
pnpm tauri build

# Type checking
pnpm check

# Rust only
cd src-tauri && cargo check
```

## Keyboard Shortcuts

> **AI Chat Input**: `Enter` inserts a newline; `Cmd+Enter` / `Ctrl+Enter` sends the message. This avoids conflicts with CJK IME composition.

## AI Configuration

Open Settings (`Cmd+,` / `Ctrl+,`) and select the **AI** and **Voice** tab. Configuration is split into three independent sections.

### Chat Providers

### Image Generation Providers

### Voice (Speech-to-Text) Providers

All API keys are stored exclusively in your OS Keychain — never in plaintext. Click **Test Connection** in each section to verify before use.

## Development Roadmap


| Version | Feature | Status |
|---------|---------|--------|
| v0.1.0-v0.3.0 | Core Editor, AI Integration, MCP Ecosystem | Complete |
| v0.4.0 | MCP Container & Dynamic Services | Complete |
| v0.5.0 | Publish Workflow (SEO, AIGC, GitHub/RSS) | Complete |
| v0.6.0 | Security Hardening (Keychain, CSP, Path validation) | Complete |
| v0.7.0-v0.8.0 | Image Scaling, Image Hosting (5 providers) | Complete |
| v0.9.0-v0.10.0 | AI Prompt Templates, Editor UX Enhancement | Complete |
| v0.11.0 | Multi-Tab Editing | Complete |
| v0.12.0 | Plugin System | Complete |
| v0.13.0 | Mermaid Diagram Support | Complete |
| v0.14.0 | AI Model & Image Hosting Enhancement | Complete |
| v0.15.0 | AI Voice Transcription | Complete |
| v0.16.0-v0.17.0 | Search & Replace, ProseMirror Performance | Complete |
| v0.18.0 | Document Outline, Table Keys, Freeze Fix | Complete |
| v0.19.0 | Rendering Pipeline v2 (Doc Cache, hljs Cache, Async Parse) | Complete |
| v0.20.0 | Multi-Language Support (12 locales, RTL) | Complete |
| v0.21.0 | AI-powered rule file automatic splitting engine | Complete |
| v0.22.0 | Built-in plugins, 10 new mainstream plugins added |

## License

[Apache License 2.0](LICENSE)