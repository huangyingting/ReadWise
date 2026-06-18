/**
 * Thin Azure OpenAI chat-completions client built on `fetch` (no SDK dependency).
 * Mirrors the project's graceful-fallback convention: when credentials are
 * absent every helper degrades to a safe no-op instead of throwing.
 */

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AzureConfig = {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
};

function readAzureConfig(): AzureConfig | null {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

  if (!endpoint || !apiKey || !deployment || !apiVersion) {
    return null;
  }
  return { endpoint, apiKey, deployment, apiVersion };
}

/** Whether the Azure OpenAI chat completion provider is configured. */
export function isAiConfigured(): boolean {
  return readAzureConfig() !== null;
}

/** The configured deployment/model name, or null when unconfigured. */
export function aiModelName(): string | null {
  return readAzureConfig()?.deployment ?? null;
}

/**
 * Runs a chat completion against the configured Azure OpenAI deployment.
 * Returns the assistant message text, or null when the provider is not
 * configured or the request fails.
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: { maxOutputTokens?: number; signal?: AbortSignal } = {},
): Promise<string | null> {
  const config = readAzureConfig();
  if (!config) {
    return null;
  }

  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${config.apiVersion}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify({
        messages,
        max_completion_tokens: options.maxOutputTokens ?? 4096,
      }),
      signal: options.signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  } catch {
    return null;
  }
}
