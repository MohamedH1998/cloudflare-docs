import {
	useState,
	useRef,
	useEffect,
	useCallback,
	type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";

type Message = {
	role: "user" | "assistant";
	content: string;
	sources?: { title: string; url: string; product: string }[];
	done?: boolean;
};

const SUGGESTIONS = [
	"How do I create a Worker?",
	"KV vs R2 — which should I use?",
	"How do cache rules work?",
	"Deploy a Next.js app on Pages",
];

const AGENT_URL =
	"https://docsfs-agent.mohamedahassan1998.workers.dev/query?stream=true";

/**
 * Strip incomplete markdown link syntax from the tail of streaming content.
 * Prevents the jarring effect where raw URLs are visible during typing
 * and then suddenly collapse into clickable links.
 */
function stripIncompleteLink(text: string): string {
	return text.replace(/\[[^\]]*(?:\]\([^)]*)?$/, "");
}

export default function AskAI() {
	const [isOpen, setIsOpen] = useState(false);
	const [mounted, setMounted] = useState(false);
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => setMounted(true), []);

	// Toggle TOC visibility, lock scroll, focus input
	useEffect(() => {
		const toc = document.querySelector(
			".right-sidebar-panel",
		) as HTMLElement | null;
		if (isOpen) {
			if (toc) toc.style.display = "none";
			document.body.style.overflow = "hidden";
			setTimeout(() => inputRef.current?.focus(), 280);
		} else {
			if (toc) toc.style.display = "";
			document.body.style.overflow = "";
		}
		return () => {
			if (toc) toc.style.display = "";
			document.body.style.overflow = "";
		};
	}, [isOpen]);

	// Auto-scroll on new messages
	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages]);

	// Escape to close
	useEffect(() => {
		if (!isOpen) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setIsOpen(false);
		}
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [isOpen]);

	const autoResize = useCallback(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = Math.min(el.scrollHeight, 120) + "px";
	}, []);

	function submitQuery(query: string) {
		if (!query.trim() || isLoading) return;
		setInput("");
		if (inputRef.current) inputRef.current.style.height = "auto";

		const idx = messages.length + 1;
		setMessages((prev) => [
			...prev,
			{ role: "user", content: query.trim() },
			{ role: "assistant", content: "", done: false },
		]);
		setIsLoading(true);
		streamResponse(query.trim(), idx);
	}

	async function streamResponse(query: string, assistantIdx: number) {
		try {
			const resp = await fetch(AGENT_URL, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ query }),
			});

			if (!resp.ok || !resp.body) {
				patchAssistant(assistantIdx, {
					content: "Something went wrong. Please try again.",
					done: true,
				});
				setIsLoading(false);
				return;
			}

			const reader = resp.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				let eventType = "";
				for (const line of lines) {
					if (line.startsWith("event: ")) {
						eventType = line.slice(7).trim();
					} else if (line.startsWith("data: ")) {
						const data = line.slice(6);
						if (eventType === "chunk") {
							try {
								const parsed = JSON.parse(data);
								const text = parsed.text || "";
								if (text) {
									setMessages((prev) => {
										const upd = [...prev];
										upd[assistantIdx] = {
											...upd[assistantIdx],
											content: upd[assistantIdx].content + text,
										};
										return upd;
									});
								}
							} catch {
								/* skip */
							}
						} else if (eventType === "done") {
							try {
								const parsed = JSON.parse(data);
								patchAssistant(assistantIdx, {
									sources: parsed.sources || [],
									done: true,
								});
							} catch {
								patchAssistant(assistantIdx, { done: true });
							}
						} else if (eventType === "error") {
							patchAssistant(assistantIdx, {
								content: "An error occurred. Please try again.",
								done: true,
							});
						}
					}
				}
			}

			setMessages((prev) => {
				const upd = [...prev];
				if (!upd[assistantIdx]?.done) {
					upd[assistantIdx] = { ...upd[assistantIdx], done: true };
				}
				return upd;
			});
		} catch {
			patchAssistant(assistantIdx, {
				content: "Network error. Check your connection and try again.",
				done: true,
			});
		}
		setIsLoading(false);
	}

	function patchAssistant(index: number, updates: Partial<Message>) {
		setMessages((prev) => {
			const upd = [...prev];
			upd[index] = { ...upd[index], ...updates };
			return upd;
		});
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		submitQuery(input);
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			submitQuery(input);
		}
	}

	const hasMessages = messages.length > 0;

	const panel = (
		<aside
			className={[
				"fixed right-0 z-20 flex flex-col",
				"top-[var(--sl-nav-height,3.5rem)]",
				"h-[calc(100vh-var(--sl-nav-height,3.5rem))]",
				"w-full sm:w-[400px]",
				"bg-[var(--sl-color-bg)]",
				"border-l border-[var(--sl-color-hairline)]",
				"shadow-[-8px_0_32px_rgba(0,0,0,0.08)]",
				"transition-transform duration-[260ms]",
				"ease-[cubic-bezier(0.4,0,0.2,1)]",
				"will-change-transform",
				isOpen ? "translate-x-0" : "translate-x-full",
			].join(" ")}
			aria-label="AI assistant"
			role="complementary"
		>
			{/* ── Panel header ── */}
			<div className="shrink-0 flex items-center justify-between px-4 py-3.5 border-b border-[var(--sl-color-hairline)]">
				<div className="flex items-center gap-2 text-[0.8125rem] font-semibold text-[var(--sl-color-white)] -tracking-[0.01em]">
					<svg
						width="14"
						height="14"
						viewBox="0 0 16 16"
						fill="currentColor"
						className="text-[var(--orange-accent-200,#f6821f)]"
						aria-hidden="true"
					>
						<path d="M8 0L9.8 6.2L16 8L9.8 9.8L8 16L6.2 9.8L0 8L6.2 6.2Z" />
					</svg>
					<span>Ask AI</span>
				</div>
				<button
					className="flex items-center justify-center w-7 h-7 rounded-md border-none bg-transparent text-[var(--sl-color-gray-3)] cursor-pointer transition-[background,color] duration-150 hover:bg-[var(--sl-color-gray-6,rgba(127,127,127,0.12))] hover:text-[var(--sl-color-white)]"
					onClick={() => setIsOpen(false)}
					aria-label="Close"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>

			{/* ── Empty state ── */}
			{!hasMessages && (
				<div className="flex-1 flex flex-col items-center justify-center px-5 py-8 gap-2">
					<div className="w-[52px] h-[52px] rounded-[14px] flex items-center justify-center bg-[var(--sl-color-bg-nav,rgba(127,127,127,0.06))] border border-[var(--sl-color-hairline)] text-[var(--orange-accent-200,#f6821f)] mb-1.5">
						<svg
							width="28"
							height="28"
							viewBox="0 0 16 16"
							fill="currentColor"
							aria-hidden="true"
						>
							<path d="M8 0L9.8 6.2L16 8L9.8 9.8L8 16L6.2 9.8L0 8L6.2 6.2Z" />
						</svg>
					</div>
					<p className="text-base font-semibold text-[var(--sl-color-white)] m-0 -tracking-[0.01em]">
						Ask anything
					</p>
					<p className="text-[0.8125rem] text-[var(--sl-color-gray-3)] m-0 text-center leading-[1.45]">
						Get answers grounded in Cloudflare's developer docs.
					</p>
					<div className="flex flex-col gap-1.5 mt-3 w-full">
						{SUGGESTIONS.map((s) => (
							<button
								key={s}
								className="px-3 py-2.5 rounded-lg border border-[var(--sl-color-hairline)] bg-[var(--sl-color-bg)] text-[var(--sl-color-text)] text-[0.8125rem] leading-[1.35] text-left cursor-pointer transition-[border-color,background] duration-150 hover:border-[var(--orange-accent-200,#f6821f)] hover:bg-[var(--sl-color-bg-nav,rgba(127,127,127,0.06))]"
								onClick={() => submitQuery(s)}
							>
								{s}
							</button>
						))}
					</div>
				</div>
			)}

			{/* ── Message thread ── */}
			{hasMessages && (
				<div
					className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 scroll-smooth overscroll-contain [scrollbar-width:thin]"
					ref={scrollRef}
				>
					{messages.map((msg, i) => (
						<div
							key={i}
							className={[
								"flex",
								msg.role === "user" ? "justify-end" : "",
							].join(" ")}
						>
							<div
								className={
									msg.role === "user"
										? "max-w-[90%] leading-[1.55] px-3 py-2 bg-[var(--orange-accent-200,#f6821f)] text-white rounded-t-[12px] rounded-bl-[12px] rounded-br-[2px] text-[0.8125rem]"
										: "max-w-full leading-[1.55] p-0"
								}
							>
								{msg.role === "user" ? (
									<p className="m-0">{msg.content}</p>
								) : msg.content ? (
									<div className="text-[0.8125rem] text-[var(--sl-color-text)] leading-[1.6]">
										<ReactMarkdown
											components={{
												p: ({ children }) => (
													<p className="mb-2 last:mb-0">{children}</p>
												),
												h2: ({ children }) => (
													<h2 className="text-[0.9375rem] font-semibold text-[var(--sl-color-white)] mt-3.5 mb-1.5 first:mt-0 -tracking-[0.01em]">
														{children}
													</h2>
												),
												h3: ({ children }) => (
													<h3 className="text-[0.875rem] font-semibold text-[var(--sl-color-white)] mt-3.5 mb-1.5 first:mt-0 -tracking-[0.01em]">
														{children}
													</h3>
												),
												h4: ({ children }) => (
													<h4 className="text-[0.8125rem] font-semibold text-[var(--sl-color-white)] mt-3.5 mb-1.5 first:mt-0 -tracking-[0.01em]">
														{children}
													</h4>
												),
												ul: ({ children }) => (
													<ul className="mb-2 pl-[1.125rem]">{children}</ul>
												),
												ol: ({ children }) => (
													<ol className="mb-2 pl-[1.125rem]">{children}</ol>
												),
												li: ({ children }) => (
													<li className="mb-0.5 marker:text-[var(--sl-color-gray-4)]">
														{children}
													</li>
												),
												a: ({ href, children }) => (
													<a
														href={href}
														target="_blank"
														rel="noopener noreferrer"
														className="text-[var(--sl-color-text-accent)] no-underline font-medium border-b border-transparent transition-[border-color] duration-150 hover:border-[var(--sl-color-text-accent)]"
													>
														{children}
													</a>
												),
												code: ({ className, children, ...props }) => {
													const isBlock =
														className?.startsWith("language-");
													return isBlock ? (
														<code
															className={`font-mono text-[var(--sl-color-text)] ${className}`}
															{...props}
														>
															{children}
														</code>
													) : (
														<code
															className="font-mono text-[0.8em] px-1.5 py-0.5 rounded-[3px] bg-[var(--sl-color-bg-inline-code,rgba(127,127,127,0.12))] text-[var(--sl-color-text)]"
															{...props}
														>
															{children}
														</code>
													);
												},
												pre: ({ children }) => (
													<pre className="my-2 px-3 py-2.5 rounded-md bg-[var(--sl-color-bg-nav,rgba(127,127,127,0.06))] border border-[var(--sl-color-hairline)] overflow-x-auto text-xs leading-[1.5]">
														{children}
													</pre>
												),
											}}
										>
											{msg.done
												? msg.content
												: stripIncompleteLink(msg.content)}
										</ReactMarkdown>
									</div>
								) : (
									<div className="flex gap-1 py-1.5">
										<span className="w-[5px] h-[5px] rounded-full bg-[var(--sl-color-gray-4)] animate-pulse" />
										<span className="w-[5px] h-[5px] rounded-full bg-[var(--sl-color-gray-4)] animate-pulse [animation-delay:0.2s]" />
										<span className="w-[5px] h-[5px] rounded-full bg-[var(--sl-color-gray-4)] animate-pulse [animation-delay:0.4s]" />
									</div>
								)}

								{msg.sources && msg.sources.length > 0 && (
									<div className="mt-3 pt-2.5 border-t border-[var(--sl-color-hairline)]">
										<span className="block text-[0.625rem] font-semibold uppercase tracking-[0.06em] text-[var(--sl-color-gray-3)] mb-1.5">
											Sources
										</span>
										<div className="flex flex-wrap gap-1">
											{msg.sources.map((src, j) => (
												<a
													key={j}
													href={src.url}
													target="_blank"
													rel="noopener noreferrer"
													className="inline-flex items-center gap-[0.2rem] text-[0.6875rem] font-medium px-2 py-[0.2rem] rounded-[5px] bg-[var(--sl-color-bg-nav,rgba(127,127,127,0.06))] border border-[var(--sl-color-hairline)] text-[var(--sl-color-text-accent)] no-underline leading-[1.35] transition-[border-color] duration-150 hover:border-[var(--sl-color-text-accent)]"
												>
													{src.title}
													<svg
														width="10"
														height="10"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2.5"
														strokeLinecap="round"
														strokeLinejoin="round"
														className="opacity-45"
														aria-hidden="true"
													>
														<path d="M7 17L17 7" />
														<path d="M7 7h10v10" />
													</svg>
												</a>
											))}
										</div>
									</div>
								)}
							</div>
						</div>
					))}
				</div>
			)}

			{/* ── Input area ── */}
			<div className="shrink-0 px-3 pt-2.5 pb-3 border-t border-[var(--sl-color-hairline)]">
				<form
					onSubmit={handleSubmit}
					className="flex items-end gap-1.5 pl-3 pr-1.5 py-1.5 bg-[var(--sl-color-bg-nav,rgba(127,127,127,0.06))] border border-[var(--sl-color-hairline)] rounded-[10px] transition-[border-color] duration-150 focus-within:border-[var(--sl-color-text-accent)]"
				>
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => {
							setInput(e.target.value);
							autoResize();
						}}
						onKeyDown={handleKeyDown}
						placeholder="Ask a question..."
						disabled={isLoading}
						rows={1}
						className="flex-1 border-none bg-transparent text-[var(--sl-color-text)] text-[0.8125rem] leading-[1.45] py-1 resize-none outline-none min-h-5 max-h-[120px] placeholder:text-[var(--sl-color-gray-4)] disabled:opacity-50"
					/>
					<button
						type="submit"
						disabled={isLoading || !input.trim()}
						className="shrink-0 w-[30px] h-[30px] rounded-[7px] border-none flex items-center justify-center bg-[var(--orange-accent-200,#f6821f)] text-white cursor-pointer transition-[opacity,transform] duration-150 hover:opacity-[0.88] active:scale-[0.94] disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none"
						aria-label="Send"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<line x1="22" y1="2" x2="11" y2="13" />
							<polygon points="22 2 15 22 11 13 2 9 22 2" />
						</svg>
					</button>
				</form>
				<p className="mt-1.5 text-[0.625rem] text-[var(--sl-color-gray-4)] text-center">
					AI-generated from Cloudflare docs. Verify critical details.
				</p>
			</div>
		</aside>
	);

	return (
		<>
			<button
				className={[
					"inline-flex items-center gap-1.5 h-9 px-3 rounded-lg",
					"border border-transparent text-[0.8125rem] font-medium",
					"leading-none whitespace-nowrap cursor-pointer",
					"transition-colors duration-150",
					isOpen
						? "bg-[var(--orange-accent-200,#f6821f)] text-white hover:opacity-[0.92]"
						: "bg-[var(--color-header-fill)] text-[var(--color-header-text)] hover:bg-[var(--color-header-line)] hover:text-[var(--color-header-hover-text)]",
				].join(" ")}
				onClick={() => setIsOpen(!isOpen)}
				aria-label={isOpen ? "Close AI assistant" : "Open AI assistant"}
				aria-expanded={isOpen}
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 16 16"
					fill="currentColor"
					className="shrink-0"
					aria-hidden="true"
				>
					<path d="M8 0L9.8 6.2L16 8L9.8 9.8L8 16L6.2 9.8L0 8L6.2 6.2Z" />
				</svg>
				<span className="hidden sm:inline">Ask AI</span>
			</button>

			{mounted && createPortal(panel, document.body)}
		</>
	);
}
