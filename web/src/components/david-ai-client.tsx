import { useMemo, type ReactNode } from "react"
import { useChat, type UseChatHelpers } from "@ai-sdk/react"
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"

export type DavidChatClient = Pick<UseChatHelpers<UIMessage>, "messages" | "sendMessage" | "setMessages" | "status" | "error" | "clearError">

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()
}

function createDavidTransport(): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortSignal,
        body: JSON.stringify({
          context: { path: window.location.pathname },
          messages: messages
            .map((message) => ({ role: message.role, content: messageText(message) }))
            .filter((message) => message.content),
        }),
      })
      const payload = await response.json().catch(() => ({})) as { reply?: string; error?: string }
      const id = globalThis.crypto?.randomUUID?.() || `david-${Date.now()}`
      const reply = String(payload.reply || (response.ok
        ? "I couldn't prepare a response just now. Please try again."
        : `David could not respond: ${payload.error || `Request failed (${response.status}).`}`))
      const chunks: UIMessageChunk[] = [
        { type: "text-start", id },
        ...(reply.match(/\S+\s*/g) || [reply]).map((delta) => ({ type: "text-delta" as const, id, delta })),
        { type: "text-end", id },
        { type: "finish", finishReason: "stop" },
      ]
      let index = 0
      return new ReadableStream<UIMessageChunk>({
        pull(controller) {
          const next = chunks[index++]
          if (next) controller.enqueue(next)
          if (index >= chunks.length) controller.close()
        },
      })
    },
    async reconnectToStream() { return null },
  }
}

export function DavidAiClient({
  id,
  initialMessages,
  children,
}: {
  id: string
  initialMessages: UIMessage[]
  children: (client: DavidChatClient) => ReactNode
}) {
  const transport = useMemo(() => createDavidTransport(), [])
  const client = useChat({ id, messages: initialMessages, transport })
  return children(client)
}

