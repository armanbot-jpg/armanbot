import {
  definePluginEntry,
  type ProviderAuthContext,
  type ProviderAuthResult,
} from "./runtime-api.js";

const DEFAULT_PROXY_PORT = 3456;
const DEFAULT_API_KEY = "proxy-no-key-needed";

// Models available through Claude Code CLI
const CLAUDE_CODE_MODELS = [
  {
    id: "opus",
    name: "Claude Opus 4.6 (via Code CLI)",
    contextWindow: 200_000,
    maxTokens: 32_000,
    reasoning: true,
  },
  {
    id: "sonnet",
    name: "Claude Sonnet 4.6 (via Code CLI)",
    contextWindow: 200_000,
    maxTokens: 32_000,
    reasoning: false,
  },
  {
    id: "haiku",
    name: "Claude Haiku 4.5 (via Code CLI)",
    contextWindow: 200_000,
    maxTokens: 8_192,
    reasoning: false,
  },
] as const;

function buildModelDefinition(model: (typeof CLAUDE_CODE_MODELS)[number]) {
  return {
    id: model.id,
    name: model.name,
    api: "anthropic-messages" as const,
    reasoning: model.reasoning,
    input: ["text"] as Array<"text" | "image">,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

function resolveProxyBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

export default definePluginEntry({
  id: "claude-code",
  name: "Claude Code Provider",
  description:
    "Routes Claude models through the local Claude Code CLI proxy, using Max subscription auth (free, no API key needed)",
  register(api) {
    const pluginConfig = (api.pluginConfig ?? {}) as { proxyPort?: number };
    const proxyPort = pluginConfig.proxyPort ?? DEFAULT_PROXY_PORT;

    api.registerProvider({
      id: "claude-code",
      label: "Claude Code",
      docsPath: "/providers/models",
      auth: [
        {
          id: "local",
          label: "Claude Code CLI",
          hint: "Routes through local Claude Code proxy (Max subscription)",
          kind: "custom",
          run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            // Check if proxy is alive
            let proxyAlive = false;
            try {
              const resp = await fetch(`${resolveProxyBaseUrl(proxyPort)}/health`);
              proxyAlive = resp.ok;
            } catch {}

            if (!proxyAlive) {
              await ctx.prompter.note({
                title: "Claude Code Proxy",
                message: `Proxy not running on port ${proxyPort}. Start it:\n  launchctl kickstart gui/$(id -u)/ai.openclaw.claude-proxy`,
              });
            }

            return {
              profiles: [
                {
                  profileId: "claude-code:local",
                  credential: {
                    type: "api_key",
                    provider: "claude-code",
                    key: DEFAULT_API_KEY,
                  },
                },
              ],
              configPatch: {
                models: {
                  providers: {
                    "claude-code": {
                      baseUrl: resolveProxyBaseUrl(proxyPort),
                      apiKey: DEFAULT_API_KEY,
                      api: "anthropic-messages",
                      models: CLAUDE_CODE_MODELS.map(buildModelDefinition),
                    },
                  },
                },
                agents: {
                  defaults: {
                    models: Object.fromEntries(
                      CLAUDE_CODE_MODELS.map((m) => [`claude-code/${m.id}`, {}]),
                    ),
                  },
                },
              },
              defaultModel: "claude-code/opus",
              notes: [
                "Claude Code proxy must be running on localhost:" + proxyPort,
                "Start: launchctl kickstart gui/$(id -u)/ai.openclaw.claude-proxy",
                "Health: curl http://127.0.0.1:" + proxyPort + "/health",
                "Models route through Claude Code CLI using Max subscription (free).",
              ],
            };
          },
        },
      ],
      wizard: {
        setup: {
          choiceId: "claude-code",
          choiceLabel: "Claude Code CLI",
          choiceHint: "Free via Max subscription",
          methodId: "local",
        },
      },
      // Detect proxy being down
      matchesContextOverflowError: ({ errorMessage }) =>
        /proxy.*timeout|ECONNREFUSED|proxy.*error/i.test(errorMessage),
      // Synthetic auth: if config has claude-code provider section, auto-resolve
      resolveSyntheticAuth: ({ providerConfig }) => {
        const hasConfig =
          Boolean(providerConfig?.baseUrl?.trim()) ||
          (Array.isArray(providerConfig?.models) && providerConfig.models.length > 0);
        if (!hasConfig) return undefined;
        return {
          apiKey: DEFAULT_API_KEY,
          source: "models.providers.claude-code (synthetic local key)",
          mode: "api-key",
        };
      },
      buildUnknownModelHint: () =>
        "Claude Code provider requires the local proxy running on port " +
        DEFAULT_PROXY_PORT +
        ". " +
        "Start it: launchctl kickstart gui/$(id -u)/ai.openclaw.claude-proxy",
    });
  },
});
