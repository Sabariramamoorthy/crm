import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { Cache } from "cache-manager";
import { z } from "zod";

const CATALOG_URL = "https://ai-gateway.vercel.sh/v1/models";

const CATALOG_TTL_MS = 30 * 60_000;

const CATALOG_KEY = "settings:model-catalog";

const CATALOG_TIMEOUT_MS = 5_000;

export interface CatalogModel {
	id: string;
	name: string;
	provider: string;
	contextWindowTokens: number;
	pricing: { input: number; output: number } | null;
}

const gatewayRate = z
	.union([z.number(), z.string()])
	.transform((value) => Number(value))
	.refine((value) => Number.isFinite(value))
	.nullable()
	.catch(null);

const gatewayModel = z.object({
	id: z.string(),
	name: z.string().catch(""),
	owned_by: z.string().catch(""),
	type: z.string().catch(""),
	tags: z.array(z.json()).catch([]),
	context_window: z.number(),
	pricing: z
		.object({ input: gatewayRate, output: gatewayRate })
		.nullable()
		.catch(null),
});

type GatewayModel = z.infer<typeof gatewayModel>;

const gatewayCatalog = z
	.object({ data: z.array(z.json()).catch([]) })
	.catch({ data: [] });

const DEFAULT_COMPATIBLE_CONTEXT_WINDOW = 128_000;

const compatibleModel = z.object({
	id: z.string(),
	owned_by: z.string().catch(""),
	context_window: z.number().optional().catch(undefined),
	context_length: z.number().optional().catch(undefined),
});

function compatibleEndpoint(): {
	url: string;
	apiKey: string;
	name: string;
} | null {
	const baseURL = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
	const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY?.trim();
	if (!baseURL || !apiKey) return null;

	return {
		url: `${baseURL.replace(/\/+$/, "")}/models`,
		apiKey,
		name: process.env.OPENAI_COMPATIBLE_NAME?.trim() || "OpenAI-compatible",
	};
}

function usable(model: GatewayModel): boolean {
	return model.type === "language" && model.tags.includes("tool-use");
}

function toCatalogModel(model: GatewayModel): CatalogModel {
	const input = model.pricing?.input ?? null;
	const output = model.pricing?.output ?? null;

	return {
		id: model.id,
		name: model.name || model.id,
		provider: model.owned_by || (model.id.split("/")[0] ?? model.id),
		contextWindowTokens: model.context_window,
		pricing: input !== null && output !== null ? { input, output } : null,
	};
}

@Injectable()
export class ModelCatalogService {
	private readonly logger = new Logger(ModelCatalogService.name);

	constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

	async models(): Promise<CatalogModel[] | null> {
		const cached = await this.cache.get<CatalogModel[]>(CATALOG_KEY);
		if (cached) return cached;

		const models = await this.fetchCatalog();
		if (!models) return null;

		await this.cache.set(CATALOG_KEY, models, CATALOG_TTL_MS);
		return models;
	}

	async find(id: string): Promise<CatalogModel | null> {
		const models = await this.models();
		return models?.find((model) => model.id === id) ?? null;
	}

	private async fetchCatalog(): Promise<CatalogModel[] | null> {
		const compatible = compatibleEndpoint();
		if (compatible) return this.fetchCompatibleCatalog(compatible);

		try {
			const response = await fetch(CATALOG_URL, {
				headers: { accept: "application/json" },
				signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
			});

			if (!response.ok) {
				this.logger.warn({
					message: "Model catalog request failed",
					status: response.status,
				});
				return null;
			}

			const body = gatewayCatalog.parse(await response.json());

			const models = body.data.flatMap((entry) => {
				const parsed = gatewayModel.safeParse(entry);
				return parsed.success && usable(parsed.data)
					? [toCatalogModel(parsed.data)]
					: [];
			});

			models.sort(
				(a, b) =>
					a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name),
			);

			this.logger.log({
				message: "Model catalog loaded",
				models: models.length,
			});

			return models;
		} catch (error) {
			this.logger.warn({
				message: "Model catalog unavailable",
				reason: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}

	private async fetchCompatibleCatalog(endpoint: {
		url: string;
		apiKey: string;
		name: string;
	}): Promise<CatalogModel[] | null> {
		try {
			const response = await fetch(endpoint.url, {
				headers: {
					accept: "application/json",
					authorization: `Bearer ${endpoint.apiKey}`,
				},
				signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
			});

			if (!response.ok) {
				this.logger.warn({
					message: "Model catalog request failed",
					provider: endpoint.name,
					status: response.status,
				});
				return null;
			}

			const body = gatewayCatalog.parse(await response.json());

			const models = body.data
				.flatMap((entry) => {
					const parsed = compatibleModel.safeParse(entry);
					if (!parsed.success) return [];
					const model = parsed.data;
					return [
						{
							id: model.id,
							name: model.id,
							provider: model.owned_by || endpoint.name,
							contextWindowTokens:
								model.context_window ??
								model.context_length ??
								DEFAULT_COMPATIBLE_CONTEXT_WINDOW,
							pricing: null,
						} satisfies CatalogModel,
					];
				})
				.sort((a, b) => a.name.localeCompare(b.name));

			this.logger.log({
				message: "Model catalog loaded",
				provider: endpoint.name,
				models: models.length,
			});

			return models;
		} catch (error) {
			this.logger.warn({
				message: "Model catalog unavailable",
				provider: endpoint.name,
				reason: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
	}
}
