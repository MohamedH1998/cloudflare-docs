/**
 * Maximum number of prose characters allowed alongside a DirectoryListing
 * component before a page is considered to have real standalone content.
 * Pages at or below this threshold are treated as pure navigation containers.
 */
export const DIRECTORY_PROSE_THRESHOLD = 250;

/**
 * Returns true if the page body consists of a DirectoryListing component with
 * DIRECTORY_PROSE_THRESHOLD characters or fewer of surrounding prose. These
 * pages are pure section index/navigation containers with no standalone content
 * worth including in llms.txt — the child pages are already listed individually.
 */
export function isDirectoryOnlyPage(body: string): boolean {
	if (!body.includes("DirectoryListing")) return false;
	// Strip import lines
	let prose = body.replace(/^import\s+.*?from\s+['"].*?['"];?\s*\n?/gm, "");
	// Strip self-closing component tags e.g. <DirectoryListing />
	prose = prose.replace(/<[A-Z][^>]*\/>/g, "");
	// Strip paired component tags and their children e.g. <Description>...</Description>
	prose = prose.replace(/<[A-Z][^>]*>[\s\S]*?<\/[A-Z][^>]*>/g, "");
	// Strip JSX comments
	prose = prose.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
	return prose.trim().length <= DIRECTORY_PROSE_THRESHOLD;
}

/**
 * Extracts partial references from `<Render file="..." product="..." />`
 * component invocations in MDX body text.
 *
 * Returns deduplicated array of "{product}/{file}" strings.
 * Handles both attribute orderings (file then product, product then file).
 */
export function extractPartialRefs(body: string): string[] {
	const refs = new Set<string>();

	// Match <Render ... /> with file and product attributes in either order
	const renderPattern =
		/<Render\s+(?:[^>]*?\s)?file=["']([^"']+)["']\s+(?:[^>]*?\s)?product=["']([^"']+)["'][^>]*\/?>/g;
	const renderPatternAlt =
		/<Render\s+(?:[^>]*?\s)?product=["']([^"']+)["']\s+(?:[^>]*?\s)?file=["']([^"']+)["'][^>]*\/?>/g;

	let match: RegExpExecArray | null;

	while ((match = renderPattern.exec(body)) !== null) {
		refs.add(`${match[2]}/${match[1]}`);
	}

	while ((match = renderPatternAlt.exec(body)) !== null) {
		refs.add(`${match[1]}/${match[2]}`);
	}

	return [...refs];
}
