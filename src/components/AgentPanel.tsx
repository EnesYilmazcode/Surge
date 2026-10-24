import { ArrowUp, Check, LoaderCircle, Sparkles, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { applyCircuitActions, parseAgentReply } from '../agent/actions'
import type { CircuitAction } from '../agent/actions'
import type { CircuitDesign } from '../types/circuit'

interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string }
interface Proposal { base: CircuitDesign; design: CircuitDesign; actions: CircuitAction[] }

export default function AgentPanel({ design, onApply }: { design: CircuitDesign; onApply: (design: CircuitDesign) => void }) {
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [thinking, setThinking] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const controller = useRef<AbortController | null>(null)
  const designRef = useRef(design)
  const bottom = useRef<HTMLDivElement>(null)
  const draftInput = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const abort = new AbortController()
    fetch('/api/surge/status', { signal: abort.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json() })
      .then((status) => setConnected(Boolean(status.configured)))
      .catch(() => { if (!abort.signal.aborted) setConnected(false) })
    return () => abort.abort()
  }, [])

  useEffect(() => {
    designRef.current = design
    if (controller.current) setError('The circuit changed, so the pending request was stopped. Send your request again for the updated board.')
    controller.current?.abort()
    setProposal(null)
  }, [design])

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [messages, thinking, proposal, error])

  const send = async (text = draft) => {
    const message = text.trim()
    if (!message || controller.current || message.length > 6000) return
    const snapshot = designRef.current
    const request = new AbortController()
    controller.current = request
    setThinking(true)
    setError('')
    setProposal(null)
    setDraft('')
    let historyStart = Math.max(0, messages.length - 12)
    while (historyStart < messages.length && messages[historyStart].role !== 'user') historyStart++
    const history = messages.slice(historyStart).map(({ role, text }) => ({ role, text }))
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', text: message }])
    try {
      const response = await fetch('/api/surge/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, design: snapshot, history }),
        signal: request.signal,
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Surge could not complete the request.')
      const result = parseAgentReply(payload)
      if (request.signal.aborted || snapshot !== designRef.current) return
      const next = applyCircuitActions(snapshot, result.actions)
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: result.reply }])
      setConnected(true)
      if (result.actions.length) setProposal({ base: snapshot, design: next, actions: result.actions })
    } catch (reason) {
      if (!request.signal.aborted) {
        setError(reason instanceof Error ? reason.message : 'Unable to reach Surge.')
        setDraft(message)
      }
    } finally {
      if (controller.current === request) {
        controller.current = null
        setThinking(false)
      }
    }
  }

  const stop = () => {
    controller.current?.abort()
    setError('Request stopped. Your circuit has not changed.')
  }

  return <section className="agent-panel panel">
    <div className="panel-title-row">
      <div className="panel-title"><Sparkles size={16} /> Surge</div>
      <span className={`model-pill ${connected ? 'connected' : ''}`}>{connected === null ? 'CONNECTING' : connected ? 'GEMINI' : 'NOT CONNECTED'}</span>
    </div>
    <div className="chat-context"><span className="status-led" /> {design.components.length} parts · {design.wires.length} connections in context</div>
    <div className="chat-messages" role="log" aria-label="Conversation with Surge" aria-live="polite">
      <div className="chat-welcome">
        <div className="agent-orb"><span /></div>
        <h2>Build something that works.</h2>
        <p>I’m Surge. Ask about your circuit, troubleshoot a connection, or describe the next small change you want to make.</p>
        <span>Changes appear as a proposal you can apply to the board.</span>
      </div>
      {messages.map((message) => <article key={message.id} className={`chat-message ${message.role}`}>
        <span className="chat-author">{message.role === 'assistant' ? 'Surge' : 'You'}</span>
        <p>{message.text}</p>
      </article>)}
      {thinking && <div className="chat-thinking"><LoaderCircle size={14} className="spin" /> Checking your circuit…</div>}
      {error && <div className="chat-error" role="alert">{error}</div>}
      {proposal && <div className="proposal-card">
        <strong>{proposal.actions.length} proposed {proposal.actions.length === 1 ? 'change' : 'changes'}</strong>
        <ul>{proposal.actions.map((action, index) => <li key={index}>{action.type.replaceAll('_', ' ')} · {action.id}</li>)}</ul>
        <div>
          <button onClick={() => {
            if (proposal.base !== designRef.current) { setProposal(null); return }
            onApply(proposal.design)
            setProposal(null)
            setMessages((current) => [...current, { id: crypto.randomUUID(), role: 'assistant', text: 'Changes applied to the board.' }])
          }}><Check size={14} /> Apply changes</button>
          <button onClick={() => setProposal(null)}>Dismiss</button>
        </div>
      </div>}
      <div ref={bottom} />
    </div>
    <div className="suggestions">
      {['Explain this circuit', 'Check for missing connections', 'Add a status LED'].map((item) =>
        <button key={item} disabled={thinking} onClick={() => { setDraft(item); draftInput.current?.focus() }}>{item}</button>)}
    </div>
    <form className="prompt-box" onSubmit={(event) => { event.preventDefault(); void send() }}>
      <textarea ref={draftInput} aria-label="Message Surge" value={draft} maxLength={6000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
      }} placeholder="Ask Surge to help with your circuit…" />
      <div className="prompt-footer">
        <span>Enter to send · Shift + Enter for a new line</span>
        {thinking ? <button type="button" className="send-button" onClick={stop} aria-label="Stop request"><Square size={12} fill="currentColor" /></button>
          : <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Send message"><ArrowUp size={16} /></button>}
      </div>
    </form>
  </section>
}
