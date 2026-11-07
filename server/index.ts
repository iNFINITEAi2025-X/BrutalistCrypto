import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import cookieParser from "cookie-parser";
import { doubleCsrf } from "csrf-csrf";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { attachUser, seedAdmin } from "./auth";
import { ensureDailyAudit } from "./audit/bookkeeper";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const MemoryStore = createMemoryStore(session);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use(
  session({
    secret: process.env.SESSION_SECRET ?? "nexus-infra-dev-secret",
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({ checkPeriod: 86_400_000 }),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 3600 * 1000,
    },
  }),
);

// CSRF protection via csrf-csrf (double-submit cookie pattern). The session
// cookie additionally uses SameSite=Lax. GET/HEAD/OPTIONS are ignored; all
// state-changing methods require the X-CSRF-Token header to match the token
// issued by GET /api/auth/csrf-token. Login is additionally rate-limited.
const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => process.env.SESSION_SECRET ?? "nexus-infra-dev-secret",
  getSessionIdentifier: (req) => req.sessionID ?? "",
  cookieName: "nexus.csrf",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  },
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req) => req.get("x-csrf-token"),
});

app.get("/api/auth/csrf-token", (req, res) => {
  // Touch the session so the session cookie is issued alongside the CSRF
  // cookie; the token is bound to the session identifier.
  req.session.csrfIssuedAt = Date.now();
  res.json({ csrfToken: generateCsrfToken(req, res) });
});

app.use(doubleCsrfProtection);

app.use(attachUser);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await seedAdmin();
  await registerRoutes(httpServer, app);

  // Ensure today's daily audit package exists, then keep it fresh hourly.
  await ensureDailyAudit().catch((err) =>
    log(`daily audit init failed: ${err instanceof Error ? err.message : err}`, "audit"),
  );
  setInterval(() => {
    void ensureDailyAudit().catch(() => {});
  }, 3600_000);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
