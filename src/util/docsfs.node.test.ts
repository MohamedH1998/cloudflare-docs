import { describe, expect, test } from "vitest";
import { extractPartialRefs, isDirectoryOnlyPage } from "./docsfs";

describe("isDirectoryOnlyPage", () => {
	test("returns false for pages without DirectoryListing", () => {
		expect(isDirectoryOnlyPage("# Hello World\n\nSome content")).toBe(false);
	});

	test("returns true for a pure DirectoryListing page", () => {
		const body = `import DirectoryListing from "~/components/DirectoryListing.astro";\n\n<DirectoryListing />`;
		expect(isDirectoryOnlyPage(body)).toBe(true);
	});

	test("returns true for DirectoryListing with minimal surrounding prose", () => {
		const body = `import DirectoryListing from "~/components/DirectoryListing.astro";\n\nShort intro.\n\n<DirectoryListing />`;
		expect(isDirectoryOnlyPage(body)).toBe(true);
	});

	test("returns false when prose exceeds threshold", () => {
		const longProse = "A".repeat(300);
		const body = `import DirectoryListing from "~/components/DirectoryListing.astro";\n\n${longProse}\n\n<DirectoryListing />`;
		expect(isDirectoryOnlyPage(body)).toBe(false);
	});

	test("strips paired component tags", () => {
		const body = `import DirectoryListing from "~/components/DirectoryListing.astro";\nimport Description from "~/components/Description.astro";\n\n<Description>Some description text</Description>\n\n<DirectoryListing />`;
		expect(isDirectoryOnlyPage(body)).toBe(true);
	});

	test("strips JSX comments", () => {
		const body = `import DirectoryListing from "~/components/DirectoryListing.astro";\n\n{/* This is a comment */}\n\n<DirectoryListing />`;
		expect(isDirectoryOnlyPage(body)).toBe(true);
	});

	test("returns false for empty body", () => {
		expect(isDirectoryOnlyPage("")).toBe(false);
	});
});

describe("extractPartialRefs", () => {
	test("returns empty array for body without Render components", () => {
		expect(extractPartialRefs("# Hello\n\nSome content")).toEqual([]);
	});

	test("extracts file-first attribute ordering", () => {
		const body = `<Render file="some-partial" product="workers" />`;
		expect(extractPartialRefs(body)).toEqual(["workers/some-partial"]);
	});

	test("extracts product-first attribute ordering", () => {
		const body = `<Render product="d1" file="binding-setup" />`;
		expect(extractPartialRefs(body)).toEqual(["d1/binding-setup"]);
	});

	test("handles multiple Render components", () => {
		const body = `<Render file="a" product="workers" />\n\nSome text\n\n<Render file="b" product="d1" />`;
		const refs = extractPartialRefs(body);
		expect(refs).toHaveLength(2);
		expect(refs).toContain("workers/a");
		expect(refs).toContain("d1/b");
	});

	test("deduplicates identical refs", () => {
		const body = `<Render file="setup" product="workers" />\n<Render file="setup" product="workers" />`;
		expect(extractPartialRefs(body)).toEqual(["workers/setup"]);
	});

	test("handles single-quoted attributes", () => {
		const body = `<Render file='partial' product='r2' />`;
		expect(extractPartialRefs(body)).toEqual(["r2/partial"]);
	});

	test("handles mixed orderings in same file", () => {
		const body = `<Render file="a" product="workers" />\n<Render product="d1" file="b" />`;
		const refs = extractPartialRefs(body);
		expect(refs).toHaveLength(2);
		expect(refs).toContain("workers/a");
		expect(refs).toContain("d1/b");
	});

	test("returns empty array for empty body", () => {
		expect(extractPartialRefs("")).toEqual([]);
	});
});
