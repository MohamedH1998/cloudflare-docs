import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { execSync } from "node:child_process";
import type {
	ManifestEnvelope,
	PageNode,
	PcxContentType,
	ProductNode,
} from "../../worker/docsfs-types";
import { extractPartialRefs, isDirectoryOnlyPage } from "~/util/docsfs";

const VALID_CONTENT_TYPES = new Set<string>([
	"changelog",
	"concept",
	"configuration",
	"content",
	"design-guide",
	"example",
	"faq",
	"get-started",
	"glossary",
	"how-to",
	"implementation-guide",
	"integration-guide",
	"learning-unit",
	"navigation",
	"overview",
	"reference",
	"reference-architecture",
	"reference-architecture-diagram",
	"release-notes",
	"solution-guide",
	"troubleshooting",
	"tutorial",
]);

export const GET: APIRoute = async () => {
	const docs = await getCollection("docs");
	const directory = await getCollection("directory");

	// Build directory lookup: YAML filename → entry
	const directoryById = new Map(directory.map((d) => [d.id, d]));

	// Build URL prefix → directory entry mapping for shortest-prefix product resolution.
	// Sort by URL length ascending so the shallowest product root matches first.
	const directoryByPrefix = directory
		.filter((d) => {
			const url = d.data.entry.url;
			return (
				typeof url === "string" && url !== "" && url !== "/" && !url.includes("#")
			);
		})
		.map((d) => ({
			// Strip leading/trailing slashes: "/workers/" → "workers"
			prefix: d.data.entry.url.slice(1, -1),
			entry: d,
		}))
		.sort((a, b) => a.prefix.length - b.prefix.length);

	/**
	 * Resolve the product slug for a doc entry ID using shortest-prefix matching
	 * against directory URL prefixes. This ensures pages are assigned to the
	 * true top-level product (e.g. "cache") rather than a sub-section that
	 * happens to have its own directory entry (e.g. "cache/how-to/cache-rules").
	 */
	function resolveProduct(docId: string): string | undefined {
		for (const { prefix, entry } of directoryByPrefix) {
			if (docId === prefix || docId.startsWith(prefix + "/")) {
				return prefix;
			}
		}
		return undefined;
	}

	/**
	 * Resolve a directory reference ID (filename) to its URL slug.
	 */
	function resolveDirectorySlug(refId: string): string | undefined {
		const entry = directoryById.get(refId);
		if (!entry) return undefined;
		const url = entry.data.entry.url;
		if (!url || url === "/" || url.includes("#")) return undefined;
		return url.slice(1, -1);
	}

	// Build lookup: product prefix → directory entry (for descriptions)
	const directoryByPrefixMap = new Map(
		directoryByPrefix.map(({ prefix, entry }) => [prefix, entry]),
	);

	// ---- First pass: build PageNodes ----
	const pages: Record<string, PageNode> = {};

	for (const doc of docs) {
		const product = resolveProduct(doc.id);
		if (!product) continue;

		const body = doc.body ?? "";

		// Resolve description: frontmatter description > summary > directory meta.description
		let description: string | undefined =
			doc.data.description || doc.data.summary || undefined;
		if (!description) {
			const dirEntry = directoryByPrefixMap.get(product);
			if (dirEntry && doc.id === product) {
				description = dirEntry.data.meta?.description || undefined;
			}
		}

		// Validate and normalize content type
		const rawContentType = doc.data.pcx_content_type?.toLowerCase();
		const contentType =
			rawContentType && VALID_CONTENT_TYPES.has(rawContentType)
				? (rawContentType as PcxContentType)
				: undefined;

		// Resolve cross-product refs from frontmatter products array
		const crossProductRefs: string[] = (doc.data.products ?? [])
			.map((ref: { id: string }) => resolveDirectorySlug(ref.id))
			.filter((slug: string | undefined): slug is string => !!slug);

		// Compute depth relative to product root
		const productSegments = product.split("/").length;
		const totalSegments = doc.id.split("/").length;
		const depth = totalSegments - productSegments;

		const page: PageNode = {
			id: doc.id,
			title: doc.data.title,
			description,
			urlPath: `/${doc.id}/`,
			contentType,
			product,
			sidebarOrder: doc.data.sidebar?.order,
			isNavigationOnly: isDirectoryOnlyPage(body),
			crossProductRefs,
			tags: doc.data.tags ?? [],
			partialRefs: extractPartialRefs(body),
			depth,
			deprioritized: !!(doc.data.noindex || doc.data.chatbot_deprioritize),
			childIds: undefined, // computed in second pass
		};

		pages[doc.id] = page;
	}

	// ---- Second pass: compute childIds ----
	for (const page of Object.values(pages)) {
		const children = Object.values(pages).filter((child) => {
			if (child.product !== page.product) return false;
			if (child.depth !== page.depth + 1) return false;
			// Must be a direct child: starts with parent ID + "/"
			// and the remaining part has no further "/"
			if (!child.id.startsWith(page.id + "/")) return false;
			const remainder = child.id.slice(page.id.length + 1);
			return !remainder.includes("/");
		});

		if (children.length > 0) {
			page.childIds = children.map((c) => c.id);
		}
	}

	// ---- Build ProductNodes ----
	const products: Record<string, ProductNode> = {};

	const pagesByProduct = new Map<string, PageNode[]>();
	for (const page of Object.values(pages)) {
		if (!pagesByProduct.has(page.product)) {
			pagesByProduct.set(page.product, []);
		}
		pagesByProduct.get(page.product)!.push(page);
	}

	for (const [productSlug, productPages] of pagesByProduct) {
		const dirEntry = directoryByPrefixMap.get(productSlug);
		if (!dirEntry) continue;

		// Only register true top-level products — sub-section directory entries
		// (e.g. "cache/how-to/cache-rules") are not products.
		if (productSlug.includes("/")) continue;

		const topLevelPageIds = productPages
			.filter((p) => p.depth === 1)
			.map((p) => p.id);

		products[productSlug] = {
			slug: productSlug,
			title: dirEntry.data.entry.title,
			group: dirEntry.data.entry.group || undefined,
			description: dirEntry.data.meta?.description || undefined,
			urlPath: `/${productSlug}/`,
			topLevelPageIds,
			pageCount: productPages.length,
		};
	}

	// ---- Build envelope ----
	const gitSha = execSync("git rev-parse HEAD").toString().trim();
	const builtAt = new Date().toISOString();
	const buildId = `v1:${gitSha.slice(0, 8)}:${builtAt}`;

	const envelope: ManifestEnvelope = {
		buildId,
		buildIdFormat: "v1",
		builtAt,
		gitSha,
		totalPages: Object.keys(pages).length,
		totalProducts: Object.keys(products).length,
		products,
		pages,
	};

	return new Response(JSON.stringify(envelope), {
		headers: {
			"content-type": "application/json",
		},
	});
};
