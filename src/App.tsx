import { Box, CheckCircle2, ChevronDown, CircleHelp, MousePointer2, Pause, Play, Plus, RotateCcw, Save, Search, Undo2, Redo2, ZoomIn } from 'lucide-react'
import { useMemo, useState } from 'react'
import { planCircuit } from './agent/planner'
import AgentPanel from './components/AgentPanel'
import CircuitScene from './components/CircuitScene'
import Inspector from './components/Inspector'
import { COMPONENT_LIBRARY, createComponent, STARTER_DESIGN } from './data/library'
import { simulateCircuit } from './engine/simulator'
import type { CircuitComponent, CircuitDesign, CircuitLayer, ComponentKind } from './types/circuit'

const initialSteps = ['Parsed design requirements', 'Selected component topology', 'Validated electrical rules', 'Ready for simulation']

function loadSavedDesign(): CircuitDesign {
  try {
    const saved = window.localStorage.getItem('surge:circuit')
    return saved ? JSON.parse(saved) as CircuitDesign : STARTER_DESIGN
  } catch {
    return STARTER_DESIGN
  }
}

export default function App() {
  const [design, setDesign] = useState<CircuitDesign>(loadSavedDesign)
  const [selectedId, setSelectedId] = useState<string | null>('u1')
  const [simulating, setSimulating] = useState(false)
  const [activeLayers, setActiveLayers] = useState<Record<CircuitLayer, boolean>>({ power: true, signal: true, ground: true })
  const [isThinking, setIsThinking] = useState(false)
  const [summary, setSummary] = useState('I built an ambient light controller with eight parts. The comparator threshold is stable and the output is ready to simulate.')
  const [steps, setSteps] = useState(initialSteps)
  const [saved, setSaved] = useState(true)
  const [search, setSearch] = useState('')

  const selected = design.components.find((item) => item.id === selectedId) ?? null
  const result = useMemo(() => simulateCircuit(design), [design])
  const library = COMPONENT_LIBRARY.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))

  const addComponent = (kind: ComponentKind) => {
    const next = createComponent(kind, design.components.length)
    setDesign((current) => ({ ...current, components: [...current.components, next] }))
    setSelectedId(next.id)
    setSaved(false)
  }

  const updateComponent = (id: string, patch: Partial<CircuitComponent>) => {
    setDesign((current) => ({ ...current, components: current.components.map((item) => item.id === id ? { ...item, ...patch } : item) }))
    setSaved(false)
  }

  const deleteComponent = (id: string) => {
    setDesign((current) => ({ ...current, components: current.components.filter((item) => item.id !== id), wires: current.wires.filter((wire) => wire.from !== id && wire.to !== id) }))
    setSelectedId(null)
    setSaved(false)
  }

  const runAgent = (prompt: string) => {
    setIsThinking(true)
    setSteps(['Interpreting your request', 'Selecting a topology'])
    window.setTimeout(() => {
      const plan = planCircuit(prompt)
      setDesign(plan.design)
      setSelectedId(plan.design.components.find((item) => item.kind === 'ic')?.id ?? plan.design.components[0]?.id ?? null)
      setSummary(plan.summary)
      setSteps(plan.steps)
      setIsThinking(false)
      setSaved(false)
    }, 850)
  }

  const saveDesign = () => {
    window.localStorage.setItem('surge:circuit', JSON.stringify(design))
    setSaved(true)
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><span /></div><strong>SURGE</strong><span className="brand-divider" /><span className="workspace-name">Circuit Studio</span></div>
      <div className="project-title">
        <div><input aria-label="Project name" value={design.name} onChange={(event) => { setDesign((current) => ({ ...current, name: event.target.value })); setSaved(false) }} /><span>{design.components.length} components · {design.wires.length} nets</span></div>
        <ChevronDown size={14} />
      </div>
      <div className="top-actions">
        <span className={`save-state ${saved ? '' : 'unsaved'}`}><CheckCircle2 size={13} /> {saved ? 'Saved locally' : 'Unsaved changes'}</span>
        <button className="icon-button" title="Help"><CircleHelp size={17} /></button>
        <button className="save-button" onClick={saveDesign}><Save size={15} /> Save</button>
      </div>
    </header>

    <div className="workspace">
      <aside className="left-rail">
        <AgentPanel isThinking={isThinking} lastSummary={summary} steps={steps} onSubmit={runAgent} />
        <section className="panel library-panel">
          <div className="panel-title-row"><div className="panel-title"><Box size={15} /> Components</div><span className="count-pill">{COMPONENT_LIBRARY.length}</span></div>
          <div className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search parts" /></div>
          <div className="component-list">
            {library.map((item) => <button key={item.kind} onClick={() => addComponent(item.kind)}>
              <span className={`component-glyph ${item.kind}`} style={{ '--part-color': item.color } as React.CSSProperties}><i /></span>
              <span><strong>{item.name}</strong><small>{item.detail}</small></span>
              <Plus size={15} />
            </button>)}
          </div>
        </section>
      </aside>

      <section className="viewport">
        <div className="viewport-toolbar">
          <div className="tool-group"><button className="active"><MousePointer2 size={15} /></button><button><ZoomIn size={15} /></button><button><RotateCcw size={15} /></button></div>
          <span className="toolbar-divider" />
          <div className="tool-group"><button><Undo2 size={15} /></button><button><Redo2 size={15} /></button></div>
        </div>
        <div className="view-label"><span>3D</span> PERSPECTIVE</div>
        <div className="canvas-wrap">
          <CircuitScene components={design.components} wires={design.wires} selectedId={selectedId} activeLayers={activeLayers} simulating={simulating} onSelect={setSelectedId} />
        </div>
        <div className="viewport-status">
          <div><span className="status-led" /> ENGINE READY</div><div>GRID 0.5 <span>MM</span></div><div>SNAP ON</div>
        </div>
        <div className="sim-controls">
          <button className={simulating ? 'running' : ''} onClick={() => setSimulating((value) => !value)}>{simulating ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />} {simulating ? 'Pause simulation' : 'Run simulation'}</button>
          <span>{simulating ? `${result.voltageOut.toFixed(2)} V live` : 'DC operating point'}</span>
        </div>
      </section>

      <Inspector selected={selected} result={result} activeLayers={activeLayers} onToggleLayer={(layer) => setActiveLayers((current) => ({ ...current, [layer]: !current[layer] }))} onUpdate={updateComponent} onDelete={deleteComponent} />
    </div>
  </main>
}
