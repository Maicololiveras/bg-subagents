import { homedir } from "node:os";
import { join } from "node:path";

import { parseCodexAnalyticsSnapshot } from "./codex-analytics-parser.js";
import type { CodexStatusProvider } from "./codex-status.js";

const ANALYTICS_URL = "https://chatgpt.com/codex/cloud/settings/analytics#usage";

type PageTextProvider = () => Promise<string>;

interface BrowserPage {
  goto(url: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
  locator(selector: string): { innerText(options: { timeout: number }): Promise<string> };
}

interface BrowserContext {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

interface PlaywrightChromium {
  launchPersistentContext(
    userDataDir: string,
    options: { channel?: string; headless: boolean },
  ): Promise<BrowserContext>;
}

interface PlaywrightModule {
  chromium: PlaywrightChromium;
}

export interface CodexAnalyticsWebProviderOptions {
  pageTextProvider?: PageTextProvider;
  playwrightLoader?: () => Promise<PlaywrightModule>;
  profileDir?: string;
  headless?: boolean;
  channel?: string;
  timeoutMs?: number;
}

export const CODEX_ANALYTICS_PROFILE_DIR = join(
  homedir(),
  ".config",
  "bg-subagents",
  "codex-analytics-browser-profile",
);

async function loadPlaywrightCore(): Promise<PlaywrightModule> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<PlaywrightModule>;
    return await dynamicImport("playwright-core");
  } catch (err) {
    throw new Error(
      "ChatGPT Codex analytics provider requires playwright-core and an installed Chrome/Edge browser",
      { cause: err },
    );
  }
}

async function readAnalyticsPageText(options: Required<CodexAnalyticsWebProviderOptions>): Promise<string> {
  const playwright = await options.playwrightLoader();
  const context = await playwright.chromium.launchPersistentContext(options.profileDir, {
    channel: options.channel,
    headless: options.headless,
  });
  try {
    const page = await context.newPage();
    await page.goto(ANALYTICS_URL, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
    return await page.locator("body").innerText({ timeout: options.timeoutMs });
  } finally {
    await context.close();
  }
}

function hasLoginGate(text: string): boolean {
  return /\b(log in|sign up|iniciar sesi[oó]n|registrarse)\b/i.test(text);
}

export function createCodexAnalyticsWebProvider(
  options: CodexAnalyticsWebProviderOptions = {},
): CodexStatusProvider {
  const resolved: Required<CodexAnalyticsWebProviderOptions> = {
    pageTextProvider:
      options.pageTextProvider ?? (() => readAnalyticsPageText(resolved)),
    playwrightLoader: options.playwrightLoader ?? loadPlaywrightCore,
    profileDir: options.profileDir ?? CODEX_ANALYTICS_PROFILE_DIR,
    headless: options.headless ?? process.env.BG_SUBAGENTS_CODEX_ANALYTICS_HEADLESS === "true",
    channel: options.channel ?? process.env.BG_SUBAGENTS_CODEX_ANALYTICS_BROWSER_CHANNEL ?? "chrome",
    timeoutMs: options.timeoutMs ?? 30_000,
  };

  return {
    name: "chatgpt-web-analytics",
    async read(now) {
      const text = await resolved.pageTextProvider();
      if (hasLoginGate(text)) {
        throw new Error(
          `ChatGPT Codex analytics requires login in the dedicated browser profile: ${resolved.profileDir}`,
        );
      }
      const snapshot = parseCodexAnalyticsSnapshot(text, now);
      snapshot.source = "chatgpt-web-analytics";
      return snapshot;
    },
  };
}
