// audit-descriptions.ts
//
// Audits description coverage across product index pages and directory YAML files.
//
// Reads:
//   - src/content/docs/*/index.mdx  -- top-level product landing pages
//   - src/content/directory/*.yaml   -- product directory metadata
//
// Outputs:
//   - Console table of coverage
//   - AUDIT/description-coverage.md  -- persistent markdown report
//
// Run:  npx tsx scripts/audit-descriptions.ts

import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join, basename, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parse as parseYaml } from "yaml";
import glob from "fast-glob";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const DOCS_DIR = join(ROOT, "src/content/docs");
const DIR_DIR = join(ROOT, "src/content/directory");
const AUDIT_DIR = join(ROOT, "AUDIT");

interface ProductEntry {
	slug: string;
	hasFmDescription: boolean;
	hasFmSummary: boolean;
	hasDescriptionComponent: boolean;
	hasDirMetaDescription: boolean;
	fmDescription?: string;
	dirMetaDescription?: string;
	descriptionComponentText?: string;
}

/**
 * Parse YAML frontmatter delimited by `---` fences.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return {};
	try {
		return parseYaml(match[1]) ?? {};
	} catch {
		return {};
	}
}

/**
 * Extract the text content inside a `<Description>...</Description>` JSX
 * component.  This is a regex heuristic -- it cannot execute MDX, but it
 * reliably captures the literal text authors write between the tags.
 */
function extractDescriptionComponent(body: string): string | undefined {
	const re = /<Description[^>]*>([\s\S]*?)<\/Description>/;
	const m = body.match(re);
	if (!m) return undefined;
	return m[1].replace(/\s+/g, " ").trim() || undefined;
}

/**
 * Derive the product slug from a directory YAML's `entry.url`.
 * e.g.  `/workers/`  -> `workers`
 *       `/cloudflare-one/`  -> `cloudflare-one`
 */
function slugFromUrl(url: string): string {
	return url.replace(/^\//, "").replace(/\/$/, "").split("/")[0];
}

// ---------------------------------------------------------------------------
// 1. Read product index pages
// ---------------------------------------------------------------------------

const indexFiles = glob.sync("src/content/docs/*/index.mdx", { cwd: ROOT });
indexFiles.sort();

const products = new Map<string, ProductEntry>();

for (const rel of indexFiles) {
	const abs = join(ROOT, rel);
	const raw = readFileSync(abs, "utf-8");
	const slug = rel.split("/")[3]; // src/content/docs/<slug>/index.mdx

	const fm = parseFrontmatter(raw);
	const descComponent = extractDescriptionComponent(raw);

	products.set(slug, {
		slug,
		hasFmDescription: typeof fm.description === "string" && fm.description.length > 0,
		hasFmSummary: typeof fm.summary === "string" && fm.summary.length > 0,
		hasDescriptionComponent: descComponent !== undefined,
		hasDirMetaDescription: false, // filled in step 3
		fmDescription: typeof fm.description === "string" ? fm.description : undefined,
		descriptionComponentText: descComponent,
	});
}

// ---------------------------------------------------------------------------
// 2. Read directory YAML files
// ---------------------------------------------------------------------------

interface DirEntry {
	filename: string;
	name: string;
	url?: string;
	slug?: string;
	metaDescription?: string;
}

const dirFiles = glob.sync("src/content/directory/*.yaml", { cwd: ROOT });
dirFiles.sort();

const dirEntries: DirEntry[] = [];

for (const rel of dirFiles) {
	const abs = join(ROOT, rel);
	const raw = readFileSync(abs, "utf-8");
	const data = parseYaml(raw) as Record<string, unknown>;
	const entry = data.entry as Record<string, unknown> | undefined;
	const meta = data.meta as Record<string, unknown> | undefined;

	const url = entry?.url as string | undefined;
	const slug = url ? slugFromUrl(url) : undefined;

	dirEntries.push({
		filename: basename(rel, ".yaml"),
		name: (data.name as string) ?? basename(rel, ".yaml"),
		url,
		slug,
		metaDescription: (meta?.description as string) ?? undefined,
	});
}

// ---------------------------------------------------------------------------
// 3. Cross-reference: attach directory meta to products
// ---------------------------------------------------------------------------

// Build a map from slug -> list of directory entries that point to that slug
const dirBySlug = new Map<string, DirEntry[]>();
for (const d of dirEntries) {
	if (!d.slug) continue;
	const list = dirBySlug.get(d.slug) ?? [];
	list.push(d);
	dirBySlug.set(d.slug, list);
}

for (const [slug, product] of products) {
	const dirs = dirBySlug.get(slug);
	if (dirs && dirs.some((d) => d.metaDescription)) {
		product.hasDirMetaDescription = true;
		product.dirMetaDescription = dirs.find((d) => d.metaDescription)?.metaDescription;
	}
}

// ---------------------------------------------------------------------------
// 4. Determine resolution for each product
// ---------------------------------------------------------------------------

function resolveSource(p: ProductEntry): string {
	if (p.hasFmDescription) return "frontmatter.description";
	if (p.hasFmSummary) return "frontmatter.summary";
	if (p.hasDirMetaDescription) return "directory.meta.description";
	if (p.hasDescriptionComponent) return "<Description> (needs render)";
	return "NONE";
}

// ---------------------------------------------------------------------------
// 5. Build output
// ---------------------------------------------------------------------------

const Y = "Y";
const N = "N";
const flag = (b: boolean) => (b ? Y : N);

// Summary counters
let countFmDesc = 0;
let countFmSummary = 0;
let countDescComp = 0;
let countDirMeta = 0;
let countNone = 0;

const rows: string[] = [];

for (const p of [...products.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
	if (p.hasFmDescription) countFmDesc++;
	if (p.hasFmSummary) countFmSummary++;
	if (p.hasDescriptionComponent) countDescComp++;
	if (p.hasDirMetaDescription) countDirMeta++;

	const resolution = resolveSource(p);
	if (resolution === "NONE") countNone++;

	rows.push(
		`| ${p.slug} | ${flag(p.hasFmDescription)} | ${flag(p.hasFmSummary)} | ${flag(p.hasDescriptionComponent)} | ${flag(p.hasDirMetaDescription)} | ${resolution} |`,
	);
}

const totalProducts = products.size;
const totalDirEntries = dirEntries.length;
const totalDirWithMeta = dirEntries.filter((d) => d.metaDescription).length;

// Orphan directory entries (no matching product index page)
const orphanDirs = dirEntries.filter((d) => d.slug && !products.has(d.slug));

const header = [
	"# Description Coverage Audit",
	"",
	`> Generated: ${new Date().toISOString()}`,
	"",
	"## Summary",
	"",
	`| Metric | Count |`,
	`| --- | --- |`,
	`| Product index pages (\`src/content/docs/*/index.mdx\`) | ${totalProducts} |`,
	`| With frontmatter \`description\` | ${countFmDesc}/${totalProducts} |`,
	`| With frontmatter \`summary\` | ${countFmSummary}/${totalProducts} |`,
	`| With \`<Description>\` component | ${countDescComp}/${totalProducts} |`,
	`| With directory YAML \`meta.description\` | ${countDirMeta}/${totalProducts} |`,
	`| No description source at all | ${countNone}/${totalProducts} |`,
	`| Directory YAML entries (total) | ${totalDirEntries} |`,
	`| Directory YAML with \`meta.description\` | ${totalDirWithMeta}/${totalDirEntries} |`,
	`| Directory entries with no matching product index | ${orphanDirs.length} |`,
	"",
	"## Coverage Table",
	"",
	"| Product Slug | FM desc | FM summary | `<Description>` | Dir YAML meta | Resolution |",
	"| --- | --- | --- | --- | --- | --- |",
	...rows,
	"",
];

if (orphanDirs.length > 0) {
	header.push(
		"## Orphan Directory Entries",
		"",
		"These directory YAML files point to a URL slug that has no top-level product `index.mdx`:",
		"",
		"| Filename | Name | URL | Has meta.description |",
		"| --- | --- | --- | --- |",
		...orphanDirs.map(
			(d) =>
				`| ${d.filename} | ${d.name} | ${d.url ?? "(none)"} | ${flag(!!d.metaDescription)} |`,
		),
		"",
	);
}

const markdown = header.join("\n");

// ---------------------------------------------------------------------------
// 6. Output
// ---------------------------------------------------------------------------

// Console output
console.log("\n=== Description Coverage Audit ===\n");
console.log(`Product index pages: ${totalProducts}`);
console.log(`  frontmatter description: ${countFmDesc}/${totalProducts}`);
console.log(`  frontmatter summary:     ${countFmSummary}/${totalProducts}`);
console.log(`  <Description> component: ${countDescComp}/${totalProducts}`);
console.log(`  directory meta.desc:     ${countDirMeta}/${totalProducts}`);
console.log(`  NO source at all:        ${countNone}/${totalProducts}`);
console.log(`\nDirectory YAML entries: ${totalDirEntries} (${totalDirWithMeta} with meta.description)`);
console.log(`Orphan directory entries (no product index): ${orphanDirs.length}`);
console.log("");

// Print a compact console table
console.log(
	"Product".padEnd(35) +
		"FM-desc  FM-summ  <Desc>   Dir-meta  Resolution",
);
console.log("-".repeat(100));

for (const p of [...products.values()].sort((a, b) => a.slug.localeCompare(b.slug))) {
	const res = resolveSource(p);
	console.log(
		p.slug.padEnd(35) +
			flag(p.hasFmDescription).padEnd(9) +
			flag(p.hasFmSummary).padEnd(9) +
			flag(p.hasDescriptionComponent).padEnd(9) +
			flag(p.hasDirMetaDescription).padEnd(10) +
			res,
	);
}

// Write markdown file
mkdirSync(AUDIT_DIR, { recursive: true });
const outPath = join(AUDIT_DIR, "description-coverage.md");
writeFileSync(outPath, markdown, "utf-8");
console.log(`\nReport written to: ${outPath}`);
