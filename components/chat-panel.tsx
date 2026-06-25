"use client";

import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import { BASE_PATH } from "@/lib/base-path";
import type { Citation } from "@/lib/types";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Worum geht es in diesem Dokument?",
  "Welche technischen Daten sind angegeben?",
  "Welche Vorteile werden genannt?",
  "Für welche Anwendungen ist das gedacht?",
  "Welche Maße oder Lasten werden genannt?",
];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations?: Citation[];
};

type ChatPanelProps = {
  docId: string;
  onCite: (citation: Citation) => void;
  activeCitationId: string | null;
};

export function ChatPanel({ docId, onCite, activeCitationId }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const counter = useRef(0);

  // Reset the conversation when the active catalog changes.
  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [docId]);

  const send = async (text: string) => {
    const value = text.trim();
    if (!value || loading) return;
    const userMsg: ChatMessage = {
      id: `u${counter.current++}`,
      role: "user",
      text: value,
    };
    const history = [...messages, userMsg].map((m) => ({
      role: m.role,
      text: m.text,
    }));
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(`${BASE_PATH}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, docId }),
      });
      if (!res.body) throw new Error("no stream");

      // Stream protocol: live answer text, then a \x1e separator followed by the
      // citations JSON. Everything before the separator is rendered live.
      const aid = `a${counter.current++}`;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let started = false;

      const splitText = (s: string) => {
        const sep = s.indexOf("\x1e");
        return sep === -1 ? s : s.slice(0, sep);
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const text = splitText(buf);
        if (!started) {
          started = true;
          setMessages((m) => [
            ...m,
            { id: aid, role: "assistant", text },
          ]);
        } else {
          setMessages((m) =>
            m.map((msg) => (msg.id === aid ? { ...msg, text } : msg)),
          );
        }
      }

      // Stream finished: parse the citations after the separator.
      let citations: Citation[] = [];
      const sep = buf.indexOf("\x1e");
      if (sep !== -1) {
        try {
          citations = JSON.parse(buf.slice(sep + 1)) as Citation[];
        } catch {
          citations = [];
        }
      }
      const finalText = splitText(buf);
      setMessages((m) =>
        started
          ? m.map((msg) =>
              msg.id === aid ? { ...msg, text: finalText, citations } : msg,
            )
          : [...m, { id: aid, role: "assistant", text: finalText, citations }],
      );
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: `a${counter.current++}`,
          role: "assistant",
          text: "Es gab einen Fehler bei der Anfrage.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
        <p className="shrink-0 text-sm font-medium">Dokumenten-Assistent</p>
        <p className="text-muted-foreground flex items-center gap-1.5 text-right text-xs">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Belegt · zitiert die genaue Seite &amp; Stelle
        </p>
      </div>

      {/* Conversation */}
      <Conversation className="flex-1">
        <ConversationContent className="gap-4">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<FileText className="h-7 w-7" />}
              title="Frag dieses Dokument"
              description="Antworten sind im PDF belegt und zitieren die genaue Seite und Stelle."
            />
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  {m.role === "assistant" ? (
                    <AssistantBody
                      text={m.text}
                      citations={m.citations ?? []}
                      onCite={onCite}
                      activeCitationId={activeCitationId}
                    />
                  ) : (
                    <span className="text-sm">{m.text}</span>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {loading &&
            (messages.length === 0 ||
              messages[messages.length - 1].role !== "assistant") && (
              <Message from="assistant">
                <MessageContent>
                  <span className="text-muted-foreground text-sm">
                    Denke nach…
                  </span>
                </MessageContent>
              </Message>
            )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Suggestions */}
      <div className="px-3 pb-2">
        <Suggestions className="w-full flex-wrap items-start gap-2 whitespace-normal">
          {SUGGESTIONS.map((s) => (
            <Suggestion key={s} suggestion={s} onClick={send} />
          ))}
        </Suggestions>
      </div>

      {/* Composer */}
      <div className="border-t p-3">
        <PromptInput
          onSubmit={(_, e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Frag etwas zu diesem Dokument…"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <span className="text-muted-foreground px-1 text-xs">
                Belegt · Klick auf ein Zitat springt zur Stelle
              </span>
            </PromptInputTools>
            <PromptInputSubmit
              status={loading ? "submitted" : "ready"}
              disabled={!input.trim() || loading}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}

function AssistantBody({
  text,
  citations,
  onCite,
  activeCitationId,
}: {
  text: string;
  citations: Citation[];
  onCite: (citation: Citation) => void;
  activeCitationId: string | null;
}) {
  // Strip the [[id]] citation markers; render the rest as Markdown (tables,
  // lists). The clickable sources below drive the page jump + highlight.
  const clean = text
    .replace(/\[\[[\s\S]*?\]\]/g, "")
    .replace(/\[\[[^\]]*$/, "") // drop a half-streamed, not-yet-closed marker
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
  const sources = citations.map((citation, i) => ({ citation, index: i + 1 }));

  return (
    <div className="space-y-3 text-sm">
      <MessageResponse>{clean}</MessageResponse>
      {sources.length > 0 && (
        <CitationSources
          sources={sources}
          onCite={onCite}
          activeCitationId={activeCitationId}
        />
      )}
    </div>
  );
}

function CitationSources({
  sources,
  onCite,
  activeCitationId,
}: {
  sources: { citation: Citation; index: number }[];
  onCite: (citation: Citation) => void;
  activeCitationId: string | null;
}) {
  return (
    <Sources>
      <SourcesTrigger count={sources.length}>
        <p className="font-medium">
          {sources.length} {sources.length === 1 ? "Quelle" : "Quellen"}
        </p>
      </SourcesTrigger>
      <SourcesContent>
        {sources.map(({ citation, index }) => (
          <button
            key={citation.id}
            type="button"
            onClick={() => onCite(citation)}
            className={cn(
              "flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition",
              activeCitationId === citation.id
                ? "border-primary bg-primary/5"
                : "hover:bg-muted",
            )}
          >
            <span className="bg-primary/15 text-primary mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[0.6rem]">
              {index}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <FileText className="h-3 w-3 shrink-0 text-primary" />
                Seite {citation.page}
              </span>
              <span className="text-muted-foreground line-clamp-2 italic">
                “{citation.snippet}”
              </span>
            </span>
          </button>
        ))}
      </SourcesContent>
    </Sources>
  );
}
