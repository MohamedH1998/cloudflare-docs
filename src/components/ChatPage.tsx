import { useState, useRef, useEffect, type FormEvent } from "react";
import ReactMarkdown from "react-markdown";

type Message = {
	role: "user" | "assistant";
	content: string;
	sources?: { title: string; url: string; product: string }[];
	done?: boolean;
};

const SUGGESTIONS = [
	"How do I set up D1 with Workers?",
	"What's the difference between KV and R2?",
	"How do I configure caching rules?",
	"Deploy a Next.js app on Pages",
];

export default function ChatPage() {
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
		}
	}, [messages]);

	function autoResize() {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = Math.min(el.scrollHeight, 160) + "px";
	}

	function submitQuery(query: string) {
		if (!query.trim() || isLoading) return;
		setInput("");
		if (inputRef.current) inputRef.current.style.height = "auto";

		const assistantIndex = messages.length + 1;
		setMessages((prev) => [
			...prev,
			{ role: "user", content: query.trim() },
			{ role: "assistant", content: "", done: false },
		]);
		setIsLoading(true);

		streamResponse(query.trim(), assistantIndex);
	}

	async function streamResponse(query: string, assistantIndex: number) {
		try {
			const resp = await fetch(
				"https://docsfs-agent.mohamedahassan1998.workers.dev/query?stream=true",
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ query }),
				},
			);

			if (!resp.ok || !resp.body) {
				updateAssistant(assistantIndex, {
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
								const text = parsed.text || parsed.chunk || data;
								setMessages((prev) => {
									const updated = [...prev];
									const msg = updated[assistantIndex];
									updated[assistantIndex] = {
										...msg,
										content: msg.content + text,
									};
									return updated;
								});
							} catch {
								/* skip malformed */
							}
						} else if (eventType === "done") {
							try {
								const parsed = JSON.parse(data);
								updateAssistant(assistantIndex, {
									sources: parsed.sources || [],
									done: true,
								});
							} catch {
								updateAssistant(assistantIndex, { done: true });
							}
						} else if (eventType === "error") {
							updateAssistant(assistantIndex, {
								content: "An error occurred. Please try again.",
								done: true,
							});
						}
					}
				}
			}

			setMessages((prev) => {
				const updated = [...prev];
				if (!updated[assistantIndex]?.done) {
					updated[assistantIndex] = { ...updated[assistantIndex], done: true };
				}
				return updated;
			});
		} catch {
			updateAssistant(assistantIndex, {
				content: "Network error. Please check your connection.",
				done: true,
			});
		}
		setIsLoading(false);
	}

	function updateAssistant(
		index: number,
		updates: Partial<Message>,
	) {
		setMessages((prev) => {
			const updated = [...prev];
			updated[index] = { ...updated[index], ...updates };
			return updated;
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

	return (
		<div className="chat-root">
			<style>{styles}</style>

			{!hasMessages && (
				<div className="chat-empty">
					<div className="chat-empty-icon">
						<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
							<path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
						</svg>
					</div>
					<h2 className="chat-empty-title">Ask Cloudflare Docs</h2>
					<p className="chat-empty-desc">
						Get answers grounded in Cloudflare's developer documentation.
					</p>
					<div className="chat-suggestions">
						{SUGGESTIONS.map((s) => (
							<button
								key={s}
								className="chat-suggestion"
								onClick={() => submitQuery(s)}
							>
								{s}
							</button>
						))}
					</div>
				</div>
			)}

			{hasMessages && (
				<div className="chat-messages" ref={scrollRef}>
					{messages.map((msg, i) => (
						<div key={i} className={`chat-msg chat-msg--${msg.role}`}>
							{msg.role === "assistant" && (
								<div className="chat-avatar">
									<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
										<path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
									</svg>
								</div>
							)}
							<div className={`chat-bubble chat-bubble--${msg.role}`}>
								{msg.role === "user" ? (
									<p className="chat-user-text">{msg.content}</p>
								) : msg.content ? (
									<div className="chat-markdown">
										<ReactMarkdown
											components={{
												a: ({ href, children }) => (
													<a href={href} target="_blank" rel="noopener noreferrer" className="chat-link">
														{children}
													</a>
												),
												code: ({ className, children, ...props }) => {
													const isBlock = className?.startsWith("language-");
													return isBlock ? (
														<code className={`chat-code-block ${className}`} {...props}>{children}</code>
													) : (
														<code className="chat-code-inline" {...props}>{children}</code>
													);
												},
												pre: ({ children }) => (
													<pre className="chat-pre">{children}</pre>
												),
											}}
										>
											{msg.content}
										</ReactMarkdown>
									</div>
								) : (
									<div className="chat-thinking">
										<span className="chat-dot" />
										<span className="chat-dot" />
										<span className="chat-dot" />
									</div>
								)}

								{msg.sources && msg.sources.length > 0 && (
									<div className="chat-sources">
										<span className="chat-sources-label">Sources</span>
										<div className="chat-sources-list">
											{msg.sources.map((src, j) => (
												<a
													key={j}
													href={src.url}
													target="_blank"
													rel="noopener noreferrer"
													className="chat-source-pill"
												>
													{src.title}
													<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
														<path d="M7 17L17 7" /><path d="M7 7h10v10" />
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

			<div className="chat-input-area">
				<form onSubmit={handleSubmit} className="chat-form">
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => {
							setInput(e.target.value);
							autoResize();
						}}
						onKeyDown={handleKeyDown}
						placeholder="Ask a question about Cloudflare..."
						disabled={isLoading}
						rows={1}
						className="chat-input"
					/>
					<button
						type="submit"
						disabled={isLoading || !input.trim()}
						className="chat-submit"
						aria-label="Send"
					>
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<line x1="22" y1="2" x2="11" y2="13" />
							<polygon points="22 2 15 22 11 13 2 9 22 2" />
						</svg>
					</button>
				</form>
				<p className="chat-disclaimer">
					Answers generated from Cloudflare documentation. Verify critical details.
				</p>
			</div>
		</div>
	);
}

const styles = `
.chat-root {
	display: flex;
	flex-direction: column;
	height: calc(100vh - 64px);
	max-width: 720px;
	margin: 0 auto;
	padding: 0;
	overflow: hidden;
}

/* ── Empty state ── */

.chat-empty {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 2rem 1.5rem;
	gap: 0.75rem;
}

.chat-empty-icon {
	width: 64px;
	height: 64px;
	border-radius: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--sl-color-bg-nav);
	border: 1px solid var(--sl-color-hairline);
	color: var(--sl-color-text-accent);
	margin-bottom: 0.5rem;
}

.chat-empty-title {
	font-size: 1.375rem;
	font-weight: 600;
	color: var(--sl-color-white);
	margin: 0;
	letter-spacing: -0.01em;
}

.chat-empty-desc {
	font-size: 0.9375rem;
	color: var(--sl-color-gray-3);
	margin: 0;
	text-align: center;
	max-width: 400px;
	line-height: 1.5;
}

.chat-suggestions {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0.5rem;
	margin-top: 1rem;
	width: 100%;
	max-width: 520px;
}

.chat-suggestion {
	padding: 0.75rem 1rem;
	border-radius: 0.5rem;
	border: 1px solid var(--sl-color-hairline);
	background: var(--sl-color-bg);
	color: var(--sl-color-text);
	font-size: 0.8125rem;
	line-height: 1.4;
	text-align: left;
	cursor: pointer;
	transition: border-color 150ms, background 150ms;
}

.chat-suggestion:hover {
	border-color: var(--sl-color-text-accent);
	background: var(--sl-color-bg-nav);
}

/* ── Messages ── */

.chat-messages {
	flex: 1;
	overflow-y: auto;
	padding: 1.5rem 1rem;
	display: flex;
	flex-direction: column;
	gap: 1.5rem;
	scroll-behavior: smooth;
	overscroll-behavior: contain;
}

.chat-messages::-webkit-scrollbar {
	width: 6px;
}

.chat-messages::-webkit-scrollbar-track {
	background: transparent;
}

.chat-messages::-webkit-scrollbar-thumb {
	background: var(--sl-color-gray-5);
	border-radius: 3px;
}

.chat-msg {
	display: flex;
	gap: 0.75rem;
	align-items: flex-start;
}

.chat-msg--user {
	justify-content: flex-end;
}

.chat-avatar {
	flex-shrink: 0;
	width: 28px;
	height: 28px;
	border-radius: 8px;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--sl-color-text-accent);
	color: #fff;
	margin-top: 2px;
}

.chat-bubble {
	max-width: 85%;
	border-radius: 12px;
	line-height: 1.6;
}

.chat-bubble--user {
	padding: 0.625rem 1rem;
	background: var(--sl-color-text-accent);
	color: #fff;
	border-radius: 12px 12px 2px 12px;
}

.chat-bubble--assistant {
	padding: 0;
}

.chat-user-text {
	margin: 0;
	font-size: 0.9375rem;
	font-weight: 400;
}

/* ── Markdown content ── */

.chat-markdown {
	font-size: 0.9375rem;
	color: var(--sl-color-text);
}

.chat-markdown p {
	margin: 0 0 0.75rem;
}

.chat-markdown p:last-child {
	margin-bottom: 0;
}

.chat-markdown h1,
.chat-markdown h2,
.chat-markdown h3,
.chat-markdown h4 {
	font-weight: 600;
	color: var(--sl-color-white);
	margin: 1.25rem 0 0.5rem;
	letter-spacing: -0.01em;
}

.chat-markdown h1:first-child,
.chat-markdown h2:first-child,
.chat-markdown h3:first-child {
	margin-top: 0;
}

.chat-markdown h2 { font-size: 1.125rem; }
.chat-markdown h3 { font-size: 1rem; }
.chat-markdown h4 { font-size: 0.9375rem; }

.chat-markdown ul,
.chat-markdown ol {
	margin: 0 0 0.75rem;
	padding-left: 1.25rem;
}

.chat-markdown li {
	margin-bottom: 0.25rem;
}

.chat-markdown li::marker {
	color: var(--sl-color-gray-4);
}

.chat-link {
	color: var(--sl-color-text-accent);
	text-decoration: none;
	font-weight: 500;
	border-bottom: 1px solid transparent;
	transition: border-color 150ms;
}

.chat-link:hover {
	border-bottom-color: var(--sl-color-text-accent);
}

.chat-pre {
	margin: 0.75rem 0;
	padding: 0.875rem 1rem;
	border-radius: 8px;
	background: var(--sl-color-bg);
	border: 1px solid var(--sl-color-hairline);
	overflow-x: auto;
	font-size: 0.8125rem;
	line-height: 1.55;
}

.chat-code-block {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	font-size: inherit;
	color: var(--sl-color-text);
}

.chat-code-inline {
	font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
	font-size: 0.85em;
	padding: 0.125rem 0.375rem;
	border-radius: 4px;
	background: var(--sl-color-bg-inline-code);
	color: var(--sl-color-text);
}

/* ── Thinking animation ── */

.chat-thinking {
	display: flex;
	gap: 4px;
	padding: 0.5rem 0;
}

.chat-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--sl-color-gray-4);
	animation: chat-bounce 1.4s ease-in-out infinite;
}

.chat-dot:nth-child(2) { animation-delay: 0.2s; }
.chat-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes chat-bounce {
	0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
	40% { opacity: 1; transform: scale(1); }
}

/* ── Sources ── */

.chat-sources {
	margin-top: 1rem;
	padding-top: 0.75rem;
	border-top: 1px solid var(--sl-color-hairline);
}

.chat-sources-label {
	display: block;
	font-size: 0.6875rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	color: var(--sl-color-gray-3);
	margin-bottom: 0.5rem;
}

.chat-sources-list {
	display: flex;
	flex-wrap: wrap;
	gap: 0.375rem;
}

.chat-source-pill {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	font-size: 0.75rem;
	font-weight: 500;
	padding: 0.25rem 0.625rem;
	border-radius: 6px;
	background: var(--sl-color-bg);
	border: 1px solid var(--sl-color-hairline);
	color: var(--sl-color-text-accent);
	text-decoration: none;
	transition: border-color 150ms, background 150ms;
	line-height: 1.4;
}

.chat-source-pill:hover {
	border-color: var(--sl-color-text-accent);
	background: var(--sl-color-bg-nav);
}

.chat-source-pill svg {
	opacity: 0.5;
}

/* ── Input area ── */

.chat-input-area {
	flex-shrink: 0;
	padding: 0.75rem 1rem 1rem;
	border-top: 1px solid var(--sl-color-hairline);
	background: var(--sl-color-bg);
}

.chat-form {
	display: flex;
	align-items: flex-end;
	gap: 0.5rem;
	padding: 0.5rem 0.5rem 0.5rem 0.875rem;
	background: var(--sl-color-bg-nav);
	border: 1px solid var(--sl-color-hairline);
	border-radius: 12px;
	transition: border-color 150ms;
}

.chat-form:focus-within {
	border-color: var(--sl-color-text-accent);
}

.chat-input {
	flex: 1;
	border: none;
	background: transparent;
	color: var(--sl-color-text);
	font-size: 0.9375rem;
	line-height: 1.5;
	padding: 0.375rem 0;
	resize: none;
	outline: none;
	font-family: inherit;
	min-height: 24px;
	max-height: 160px;
}

.chat-input::placeholder {
	color: var(--sl-color-gray-4);
}

.chat-input:disabled {
	opacity: 0.5;
}

.chat-submit {
	flex-shrink: 0;
	width: 36px;
	height: 36px;
	border-radius: 8px;
	border: none;
	display: flex;
	align-items: center;
	justify-content: center;
	background: var(--sl-color-text-accent);
	color: #fff;
	cursor: pointer;
	transition: opacity 150ms, transform 100ms;
}

.chat-submit:hover:not(:disabled) {
	opacity: 0.9;
}

.chat-submit:active:not(:disabled) {
	transform: scale(0.95);
}

.chat-submit:disabled {
	opacity: 0.35;
	cursor: not-allowed;
}

.chat-disclaimer {
	margin: 0.5rem 0 0;
	font-size: 0.6875rem;
	color: var(--sl-color-gray-4);
	text-align: center;
}

/* ── Responsive ── */

@media (max-width: 640px) {
	.chat-suggestions {
		grid-template-columns: 1fr;
	}

	.chat-bubble {
		max-width: 92%;
	}

	.chat-empty {
		padding: 1.5rem 1rem;
	}
}
`;
