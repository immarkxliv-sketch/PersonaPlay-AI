import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database("persona_play.db");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT,
    personality TEXT,
    habits TEXT,
    emotions TEXT,
    nature TEXT,
    avatarSeed TEXT,
    avatarUrl TEXT,
    avatarPrompt TEXT,
    memory TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    characterId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    imageUrl TEXT,
    imageDescription TEXT,
    FOREIGN KEY (characterId) REFERENCES characters(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    avatarUrl TEXT
  );
`);

// Migration check for userId column (in case table existed before userId was added)
try {
  const charCols = db.prepare("PRAGMA table_info(characters)").all();
  if (!charCols.find((c: any) => c.name === 'userId')) {
    db.exec("ALTER TABLE characters ADD COLUMN userId TEXT NOT NULL DEFAULT 'default'");
  }
  if (!charCols.find((c: any) => c.name === 'memory')) {
    db.exec("ALTER TABLE characters ADD COLUMN memory TEXT");
  }
  const msgCols = db.prepare("PRAGMA table_info(messages)").all();
  if (!msgCols.find((c: any) => c.name === 'userId')) {
    db.exec("ALTER TABLE messages ADD COLUMN userId TEXT NOT NULL DEFAULT 'default'");
  }
} catch (e) {
  console.error("Migration failed", e);
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API Routes
  app.get(["/api/characters", "/api/characters/"], (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const characters = db.prepare("SELECT * FROM characters WHERE userId = ?").all(userId);
      res.json(characters.map((c: any) => ({
        ...c,
        habits: JSON.parse(c.habits || "[]")
      })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(["/api/characters", "/api/characters/"], (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const char = req.body;
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO characters (id, userId, name, role, personality, habits, emotions, nature, avatarSeed, avatarUrl, avatarPrompt, memory)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        char.id,
        userId,
        char.name,
        char.role,
        char.personality,
        JSON.stringify(char.habits),
        char.emotions,
        char.nature,
        char.avatarSeed,
        char.avatarUrl,
        char.avatarPrompt,
        char.memory
      );
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/characters/:id", (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      db.prepare("DELETE FROM characters WHERE id = ? AND userId = ?").run(req.params.id, userId);
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(["/api/messages/:characterId", "/api/messages/:characterId/"], (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const messages = db.prepare("SELECT * FROM messages WHERE characterId = ? AND userId = ? ORDER BY timestamp ASC").all(req.params.characterId, userId);
      res.json(messages);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(["/api/messages", "/api/messages/"], (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const msg = req.body;
      const stmt = db.prepare(`
        INSERT INTO messages (id, userId, characterId, role, content, timestamp, imageUrl, imageDescription)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(msg.id, userId, msg.characterId, msg.role, msg.content, msg.timestamp, msg.imageUrl, msg.imageDescription);
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/messages/:characterId", (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      db.prepare("DELETE FROM messages WHERE characterId = ? AND userId = ?").run(req.params.characterId, userId);
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get(["/api/user/profile", "/api/user/profile/"], (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      res.json(user || { id: userId, avatarUrl: null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post(["/api/user/profile", "/api/user/profile/"], (req, res) => {
    try {
      const userId = req.headers["x-user-id"];
      if (!userId) return res.status(400).json({ error: "Missing userId" });

      const { avatarUrl } = req.body;
      db.prepare("INSERT OR REPLACE INTO users (id, avatarUrl) VALUES (?, ?)").run(userId, avatarUrl);
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API 404 handler
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
