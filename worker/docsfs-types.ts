/**
 * DocsFS manifest type declarations.
 *
 * These types define the contract between the cloudflare-docs Worker
 * (which will expose a compiled content manifest via WorkerEntrypoint RPC)
 * and the docsfs-agent Worker (which consumes it over Service Bindings).
 *
 * Phase 0: declarations only — no implementation.
 */

// ---------------------------------------------------------------------------
// Content type union — 22 normalized (lowercase) values from pcx_content_type
// ---------------------------------------------------------------------------

export type PcxContentType =
	| "changelog"
	| "concept"
	| "configuration"
	| "content"
	| "design-guide"
	| "example"
	| "faq"
	| "get-started"
	| "glossary"
	| "how-to"
	| "implementation-guide"
	| "integration-guide"
	| "learning-unit"
	| "navigation"
	| "overview"
	| "reference"
	| "reference-architecture"
	| "reference-architecture-diagram"
	| "release-notes"
	| "solution-guide"
	| "troubleshooting"
	| "tutorial";

// ---------------------------------------------------------------------------
// PageNode — one page in the manifest
// ---------------------------------------------------------------------------

export interface PageNode {
	/** Content collection ID, e.g. "workers/configuration/secrets" */
	id: string;
	/** Resolved page title from frontmatter */
	title: string;
	/** Resolved: frontmatter description > summary > directory YAML > undefined */
	description: string | undefined;
	/** Canonical URL path, e.g. "/workers/configuration/secrets/" */
	urlPath: string;
	/** Normalized pcx_content_type (lowercase) */
	contentType: PcxContentType | undefined;
	/** Product slug derived from first path segment */
	product: string;
	/** From frontmatter sidebar.order */
	sidebarOrder: number | undefined;
	/** True if page is a DirectoryListing-only container (mirrors isDirectoryOnlyPage) */
	isNavigationOnly: boolean;
	/** Product slugs from frontmatter `products` array */
	crossProductRefs: string[];
	/** From frontmatter `tags` array */
	tags: string[];
	/** Partial references from <Render file="..." product="..." />, as "{product}/{file}" */
	partialRefs: string[];
	/** Nesting depth: 0 = product root, 1 = first-level section, etc. */
	depth: number;
	/** True if noindex or chatbot_deprioritize is set */
	deprioritized: boolean;
	/** Direct child page IDs for section index pages; undefined for leaf pages */
	childIds: string[] | undefined;
}

// ---------------------------------------------------------------------------
// ProductNode — top-level product in the manifest
// ---------------------------------------------------------------------------

export interface ProductNode {
	/** Product slug, e.g. "workers", "d1" */
	slug: string;
	/** Display title from directory YAML */
	title: string;
	/** Primary group from directory YAML entry.group */
	group: string | undefined;
	/** From directory YAML meta.description */
	description: string | undefined;
	/** Canonical URL path, e.g. "/workers/" */
	urlPath: string;
	/** IDs of direct children of the product root */
	topLevelPageIds: string[];
	/** Total number of pages under this product */
	pageCount: number;
}

// ---------------------------------------------------------------------------
// ManifestEnvelope — top-level manifest wrapper
// ---------------------------------------------------------------------------

export interface ManifestEnvelope {
	/** Format: "v1:{8-char-git-sha}:{iso-timestamp}" */
	buildId: string;
	/** Schema version prefix for compatibility checking */
	buildIdFormat: "v1";
	/** ISO 8601 timestamp of when the manifest was built */
	builtAt: string;
	/** Full 40-character git SHA */
	gitSha: string;
	/** Total number of pages in the manifest */
	totalPages: number;
	/** Total number of products in the manifest */
	totalProducts: number;
	/** Products keyed by slug */
	products: Record<string, ProductNode>;
	/** Pages keyed by content collection ID */
	pages: Record<string, PageNode>;
}

// ---------------------------------------------------------------------------
// RPC response types
// ---------------------------------------------------------------------------

export interface BuildInfo {
	buildId: string;
	builtAt: string;
	gitSha: string;
	totalPages: number;
}

export interface ProductListResult {
	products: ProductNode[];
}

export interface ManifestSearchResult {
	matches: PageNode[];
	totalMatches: number;
	truncated: boolean;
}

// ---------------------------------------------------------------------------
// DocsManifestRPC — WorkerEntrypoint RPC interface
// ---------------------------------------------------------------------------

export interface DocsManifestRPC {
	/** Cheap staleness check — returns build metadata only */
	getBuildInfo(): Promise<BuildInfo>;
	/** Full manifest (~2-4 MB JSON) */
	getManifest(): Promise<ManifestEnvelope>;
	/** Product list only */
	getProducts(): Promise<ProductListResult>;
	/** All pages for a single product */
	getProductPages(productSlug: string): Promise<PageNode[]>;
	/** Single page lookup by content collection ID */
	getPage(pageId: string): Promise<PageNode | undefined>;
	/** Keyword search across titles and descriptions */
	searchPages(query: string, limit?: number): Promise<ManifestSearchResult>;
}
