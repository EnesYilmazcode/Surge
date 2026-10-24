import { ArrowUp, Check, ChevronDown, Sparkles } from 'lucide-react'
import { useState } from 'react'

interface AgentPanelProps {
  isThinking: boolean
  lastSummary: string
  steps: string[]
  onSubmit: (prompt: string) => void
}

export default function AgentPanel({ isThinking, lastSummary, steps, onSubmit }: AgentPanelProps) {
  const [prompt, setPrompt] = useState('')
  const submit = () => {
    if (!prompt.trim() || isThinking) return
    onSubmit(prompt.trim())
    setPrompt('')
  }

  return <section className="agent-panel panel">
    <div className="panel-title-row">
      <div className="panel-title"><Sparkles size={15} /> Design agent</div>
      <button className="model-pill">SURGE-1 <ChevronDown size={12} /></button>
    </div>
    <div className="agent-thread">
      <div className="agent-orb"><span /></div>
      <div className="agent-copy">
        <span className="eyebrow">DESIGN SUMMARY</span>
        <p>{isThinking ? 'Exploring circuit topology and checking constraints…' : lastSummary}</p>
        {steps.length > 0 && <div className="agent-steps">
          {steps.map((step, index) => <div key={step} className={isThinking && index === steps.length - 1 ? 'working' : ''}><Check size={12} /> {step}</div>)}
        </div>}
      </div>
    </div>
    <div className="prompt-box">
      <textarea aria-label="Describe your circuit" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder="Describe a circuit or revision…" />
      <div className="prompt-footer">
        <span>↵ to design</span>
        <button className="send-button" onClick={submit} disabled={!prompt.trim() || isThinking} aria-label="Submit prompt"><ArrowUp size={16} /></button>
      </div>
    </div>
    <div className="suggestions">
      {['Make it battery powered', 'Add a status LED', 'Design a motor driver'].map((item) => <button key={item} onClick={() => onSubmit(item)}>{item}</button>)}
    </div>
  </section>
}
