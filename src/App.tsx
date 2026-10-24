import { Box, CheckCircle2, ChevronDown, CircleHelp, Download, FolderOpen, MousePointer2, Pause, Play, Plus, RotateCcw, Save, Search, Undo2, Redo2, ZoomIn } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { planCircuit } from './agent/planner'
import AgentPanel from './components/AgentPanel'
import CircuitScene from './components/CircuitScene'
import Inspector from './components/Inspector'
import { COMPONENT_LIBRARY, createComponent, STARTER_DESIGN } from './data/library'
import { nearestHole } from './data/breadboard'
import { MAX_PROJECT_BYTES, parseProject, projectFilename, serializeProject, validateDesign } from './data/project-file'
import { simulateCircuit } from './engine/simulator'
import type { CircuitComponent, CircuitDesign, CircuitLayer, ComponentKind } from './types/circuit'

const initialSteps = ['Parsed design requirements', 'Selected component topology', 'Validated electrical rules', 'Ready for simulation']

function loadSavedDesign(): CircuitDesign {
  try {
    const saved = window.localStorage.getItem('surge:circuit')
    return saved ? validateDesign(JSON.parse(saved)) : STARTER_DESIGN
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
  const [fileNotice, setFileNotice] = useState<{ message: string; error: boolean } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const agentRun = useRef(0)
  const [placementKind, setPlacementKind] = useState<ComponentKind | null>(null)

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlacementKind(null) }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [])

  const selected = design.components.find((item) => item.id === selectedId) ?? null
  const result = useMemo(() => simulateCircuit(design), [design])
  const library = COMPONENT_LIBRARY.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))

  const placeComponent = (x: number, z: number) => {
    if (!placementKind) { setSelectedId(null); return }
    const hole = nearestHole(x, z)
    if (!hole) return
    const next = createComponent(placementKind, design.components.length)
    next.position = [hole.x, 0, hole.z]
    next.id = crypto.randomUUID()
    setDesign((current) => ({ ...current, components: [...current.components, next] }))
    setSelectedId(next.id)
    setSaved(false)
    setPlacementKind(null)
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
    if (isThinking) return
    const run = ++agentRun.current
    setIsThinking(true)
    setSteps(['Interpreting your request', 'Selecting a topology'])
    window.setTimeout(() => {
      if (run !== agentRun.current) return
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
    try {
      window.localStorage.setItem('surge:circuit', JSON.stringify(design))
      setSaved(true)
      setFileNotice({ message: 'Circuit saved in this browser.', error: false })
    } catch {
      setFileNotice({ message: 'Browser storage is unavailable. Export a circuit file to keep your work.', error: true })
    }
  }

  const exportProject = () => {
    try {
      const url = URL.createObjectURL(new Blob([serializeProject(design)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = projectFilename(design.name)
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setFileNotice({ message: 'Circuit file exported.', error: false })
    } catch (error) {
      setFileNotice({ message: error instanceof Error ? error.message : 'Unable to export circuit.', error: true })
    }
  }

  const importProject = async (file: File) => {
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('Choose a circuit file smaller than 2 MB.')
      const imported = parseProject(await file.text())
      ++agentRun.current
      setIsThinking(false)
      setDesign(imported)
      setSelectedId(imported.components[0]?.id ?? null)
      setSimulating(false)
      setSaved(false)
      setSummary(`Opened ${imported.name || 'untitled circuit'} with ${imported.components.length} components and ${imported.wires.length} connections.`)
      setSteps(['Imported circuit file', 'Validated components and connections'])
      setFileNotice({ message: 'Circuit opened. Save to keep it in this browser.', error: false })
    } catch (error) {
      setFileNotice({ message: error instanceof Error ? error.message : 'Unable to open circuit.', error: true })
    }
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><span /></div><strong>SURGE</strong><span className="brand-divider" /><span className="workspace-name">Circuit Studio</span></div>
      <div className="project-title">
        <div><input aria-label="Project name" value={design.name} onChange={(event) => { setDesign((current) => ({ ...current, name: event.target.value })); setSaved(false) }} /><span>{design.components.length} components · {design.wires.length} nets</span></div>
        <ChevronDown size={14} />
      </div>
      <div className="top-actions">
        <input ref={fileInput} className="file-input" type="file" accept=".json,application/json" aria-label="Open circuit file" onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void importProject(file)
        }} />
        <span className={`save-state ${saved ? '' : 'unsaved'}`}><CheckCircle2 size={13} /> {saved ? 'Saved locally' : 'Unsaved changes'}</span>
        <button className="icon-button" title="Open circuit file" aria-label="Open circuit file" onClick={() => fileInput.current?.click()}><FolderOpen size={17} /></button>
        <button className="icon-button" title="Export circuit file" aria-label="Export circuit file" onClick={exportProject}><Download size={17} /></button>
        <button className="icon-button" title="Help"><CircleHelp size={17} /></button>
        <button className="save-button" onClick={saveDesign}><Save size={15} /> Save</button>
      </div>
    </header>

    <div className="workspace">
      <aside className="left-rail">
        <section className="panel library-panel">
          <div className="panel-title-row"><div className="panel-title"><Box size={15} /> Components</div><span className="count-pill">{COMPONENT_LIBRARY.length}</span></div>
          <div className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search parts" /></div>
          <div className="component-list">
            {library.map((item) => <button key={item.kind} className={placementKind === item.kind ? 'selected-part' : ''} onClick={() => setPlacementKind(item.kind)}>
              <span className={`component-glyph ${item.kind}`} style={{ '--part-color': item.color } as React.CSSProperties}><i /></span>
              <span><strong>{item.name}</strong><small>{item.detail}</small></span>
              <Plus size={15} />
            </button>)}
          </div>
        </section>
        <Inspector selected={selected} result={result} activeLayers={activeLayers} onToggleLayer={(layer) => setActiveLayers((current) => ({ ...current, [layer]: !current[layer] }))} onUpdate={updateComponent} onDelete={deleteComponent} />
      </aside>

      <section className={`viewport ${placementKind ? 'placing' : ''}`}>
        {placementKind && <div className="placement-hint">Click a socket to place {COMPONENT_LIBRARY.find((item) => item.kind === placementKind)?.name}<button onClick={() => setPlacementKind(null)}>Cancel · Esc</button></div>}
        {fileNotice && <div className={`file-notice ${fileNotice.error ? 'error' : ''}`} role={fileNotice.error ? 'alert' : 'status'}>
          <span>{fileNotice.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setFileNotice(null)}>×</button>
        </div>}
        <div className="viewport-toolbar">
          <div className="tool-group"><button className="active"><MousePointer2 size={15} /></button><button><ZoomIn size={15} /></button><button><RotateCcw size={15} /></button></div>
          <span className="toolbar-divider" />
          <div className="tool-group"><button><Undo2 size={15} /></button><button><Redo2 size={15} /></button></div>
        </div>
        <div className="view-label"><span>3D</span> PERSPECTIVE</div>
        <div className="canvas-wrap">
          <CircuitScene components={design.components} wires={design.wires} selectedId={selectedId} activeLayers={activeLayers} simulating={simulating} onSelect={setSelectedId} onPlace={placeComponent} />
        </div>
        <div className="viewport-status">
          <div><span className="status-led" /> BREADBOARD</div><div>30 COLUMNS</div><div>SOCKET SNAP</div>
        </div>
        <div className="sim-controls">
          <button className={simulating ? 'running' : ''} onClick={() => setSimulating((value) => !value)}>{simulating ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />} {simulating ? 'Pause simulation' : 'Run simulation'}</button>
          <span>{simulating ? `${result.voltageOut.toFixed(2)} V live` : 'DC operating point'}</span>
        </div>
      </section>

      <aside className="right-rail chat-rail">
        <AgentPanel isThinking={isThinking} lastSummary={summary} steps={steps} onSubmit={runAgent} />
      </aside>
    </div>
  </main>
}
