import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const optional = (key: string): string | undefined => {
	const value = process.env[key]?.trim();
	return value ? value : undefined;
};

/**
 * Routes every model id the agent resolves to an OpenAI-compatible endpoint
 * (for example TokenHarbor) instead of the Vercel AI Gateway. Off unless both
 * OPENAI_COMPATIBLE_BASE_URL and OPENAI_COMPATIBLE_API_KEY are set.
 */
export function installOpenAICompatibleProvider(): void {
	const baseURL = optional("OPENAI_COMPATIBLE_BASE_URL");
	const apiKey = optional("OPENAI_COMPATIBLE_API_KEY");
	if (!baseURL || !apiKey) return;

	const name = optional("OPENAI_COMPATIBLE_NAME") ?? "openai-compatible";
	const fallbackModel = optional("AGENT_MODEL_ID");
	const base = createOpenAICompatible({
		name,
		baseURL,
		apiKey,
		includeUsage: true,
	});

	// "vendor/model" ids are AI Gateway ids; this endpoint uses its own names.
	const resolve = (id: string): string => {
		if (!id.includes("/")) return id;
		return fallbackModel ?? id.slice(id.indexOf("/") + 1);
	};

	globalThis.AI_SDK_DEFAULT_PROVIDER = {
		specificationVersion: "v4",
		languageModel: (id: string) => base.languageModel(resolve(id)),
		embeddingModel: (id: string) => base.embeddingModel(id),
		imageModel: (id: string) => base.imageModel(id),
	};

	console.log(`[agent] on   Models (${name} at ${new URL(baseURL).host})`);
}
