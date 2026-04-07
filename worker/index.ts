import { WorkerEntrypoint } from "cloudflare:workers";
import { generateRedirectsEvaluator } from "redirects-in-workers";
import redirectsFileContents from "../dist/__redirects";
import manifestJsonText from "../dist/docsfs-manifest.json";
import type {
	BuildInfo,
	ManifestEnvelope,
	ManifestSearchResult,
	PageNode,
	ProductListResult,
} from "./docsfs-types";

const redirectsEvaluator = generateRedirectsEvaluator(redirectsFileContents, {
	maxLineLength: 10_000, // Usually 2_000
	maxStaticRules: 10_000, // Usually 2_000
	maxDynamicRules: 2_000, // Usually 100
});

const manifest: ManifestEnvelope = JSON.parse(manifestJsonText);

const LLMS_FULL_R2_PREFIX = "v1/cloudflare-docs-llms-full";

/**
 * When a redirect response is returned for an index.md request, rewrite the
 * Location header so the agent stays in Markdown land instead of landing on
 * an HTML page.
 *
 * Only rewrites relative (same-origin) Location values — external redirects
 * (e.g. to GitHub) are left untouched because appending index.md to a
 * non-docs URL would be nonsensical.
 */
function rewriteRedirectForMarkdown(
	redirect: Response,
	requestUrl: URL,
): Response {
	const location = redirect.headers.get("Location");
	if (!location) return redirect;

	try {
		const dest = new URL(location, requestUrl.origin);

		// Only rewrite same-origin redirects that point to a docs path (trailing /)
		if (dest.origin !== requestUrl.origin) return redirect;
		if (!dest.pathname.endsWith("/")) return redirect;

		dest.pathname += "index.md";

		const headers = new Headers(redirect.headers);
		headers.set("Location", dest.pathname + dest.search + dest.hash);
		return new Response(redirect.body, {
			status: redirect.status,
			headers,
		});
	} catch {
		return redirect;
	}
}

export default class extends WorkerEntrypoint<Env> {
	override async fetch(request: Request) {
		if (request.url.endsWith("/llms-full.txt")) {
			const { pathname } = new URL(request.url);
			// pathname is e.g. "/llms-full.txt" or "/workers/llms-full.txt"
			// R2 key: "v1/cloudflare-docs-llms-full/llms-full.txt" or
			//         "v1/cloudflare-docs-llms-full/workers/llms-full.txt"
			const r2Key = `${LLMS_FULL_R2_PREFIX}${pathname}`;
			const object = await this.env.MIDDLECACHE.get(r2Key);

			if (!object) {
				return new Response("llms-full.txt not found", { status: 404 });
			}

			return new Response(object.body, {
				headers: {
					"Content-Type": "text/markdown; charset=utf-8",
				},
			});
		}

		const url = new URL(request.url);
		const isMarkdownRequest = url.pathname.endsWith("/index.md");

		try {
			try {
				// For index.md requests, evaluate redirects against the base path
				// (without the index.md suffix) so that redirect rules written for
				// the HTML path (e.g. /learning-paths/ → /resources/) still fire.
				const evalRequest = isMarkdownRequest
					? new Request(
							url.origin +
								url.pathname.slice(0, -"index.md".length) +
								url.search,
							request,
						)
					: request;

				const redirect = await redirectsEvaluator(evalRequest, this.env.ASSETS);
				if (redirect) {
					return isMarkdownRequest
						? rewriteRedirectForMarkdown(redirect, url)
						: redirect;
				}
			} catch (error) {
				console.error("Could not evaluate redirects", error);
			}

			try {
				const forceTrailingSlashURL = new URL(
					request.url.replace(/([^/])$/, "$1/"),
					request.url,
				);
				const redirect = await redirectsEvaluator(
					new Request(forceTrailingSlashURL, request),
					this.env.ASSETS,
				);
				if (redirect) {
					return isMarkdownRequest
						? rewriteRedirectForMarkdown(redirect, url)
						: redirect;
				}
			} catch (error) {
				console.error(
					"Could not evaluate redirects with a forced trailing slash",
					error,
				);
			}
		} catch (error) {
			console.error("Unknown error", error);
		}

		const response = await this.env.ASSETS.fetch(request);

		if (response.status === 404) {
			const section = new URL(response.url).pathname.split("/").at(1);

			if (!section) return response;

			const notFoundResponse = await this.env.ASSETS.fetch(
				`http://fakehost/${section}/404/`,
			);

			return new Response(notFoundResponse.body, {
				status: 404,
				headers: notFoundResponse.headers,
			});
		}

		return response;
	}

	// ---- DocsFS RPC methods ----

	async getBuildInfo(): Promise<BuildInfo> {
		return {
			buildId: manifest.buildId,
			builtAt: manifest.builtAt,
			gitSha: manifest.gitSha,
			totalPages: manifest.totalPages,
		};
	}

	async getManifest(): Promise<ManifestEnvelope> {
		return manifest;
	}

	async getProducts(): Promise<ProductListResult> {
		return { products: Object.values(manifest.products) };
	}

	async getProductPages(productSlug: string): Promise<PageNode[]> {
		return Object.values(manifest.pages).filter(
			(p) => p.product === productSlug,
		);
	}

	async getPage(pageId: string): Promise<PageNode | undefined> {
		return manifest.pages[pageId];
	}

	async searchPages(
		query: string,
		limit = 20,
	): Promise<ManifestSearchResult> {
		const tokens = query
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 0);

		if (tokens.length === 0) {
			return { matches: [], totalMatches: 0, truncated: false };
		}

		const scored: { page: PageNode; score: number }[] = [];

		for (const page of Object.values(manifest.pages)) {
			const titleLower = page.title.toLowerCase();
			const idLower = page.id.toLowerCase();
			const descLower = (page.description ?? "").toLowerCase();

			let score = 0;
			let allMatch = true;

			for (const token of tokens) {
				const titleMatch = titleLower.includes(token);
				const idMatch = idLower.includes(token);
				const descMatch = descLower.includes(token);

				if (!titleMatch && !idMatch && !descMatch) {
					allMatch = false;
					break;
				}

				if (titleMatch) score += 3;
				if (idMatch) score += 2;
				if (descMatch) score += 1;
			}

			if (!allMatch) continue;

			// Deprioritize flagged pages
			if (page.deprioritized) {
				score *= 0.5;
			}

			scored.push({ page, score });
		}

		// Sort by score descending, then depth ascending
		scored.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			return a.page.depth - b.page.depth;
		});

		const totalMatches = scored.length;
		const matches = scored.slice(0, limit).map((s) => s.page);

		return {
			matches,
			totalMatches,
			truncated: totalMatches > limit,
		};
	}
}
