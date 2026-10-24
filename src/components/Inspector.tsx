import { Activity, Box, ChevronRight, Layers3, SlidersHorizontal, Trash2, Zap } from 'lucide-react'
import type { CircuitComponent, CircuitLayer, SimulationResult } from '../types/circuit'

interface InspectorProps {
  selected: CircuitComponent | null
  result: SimulationResult
  activeLayers: Record<CircuitLayer, boolean>
  onToggleLayer: (layer: CircuitLayer) => void
  onUpdate: (id: string, patch: Partial<CircuitComponent>) => void
  onDelete: (id: string) => void
}

const layerMeta: Array<{ id: CircuitLayer; name: string; color: string }> = [
  { id: 'power', name: 'Power', color: '#b66b0a' },
  { id: 'signal', name: 'Signals', color: '#087f70' },
  { id: 'ground', name: 'Ground', color: '#637873' },
]

export default function Inspector({ selected, result, activeLayers, onToggleLayer, onUpdate, onDelete }: InspectorProps) {
  return <div className="inspector-stack">
    <section className="panel inspector-panel">
      <div className="panel-title"><SlidersHorizontal size={15} /> Inspector</div>
      {selected ? <div className="inspector-content">
        <div className="part-heading">
          <div className="part-icon"><Box size={19} /></div>
          <div><strong>{selected.label}</strong><span>{selected.description}</span></div>
          <span className="kind-tag">{selected.kind}</span>
        </div>
        <label className="field-label">REFERENCE
          <input value={selected.label} onChange={(event) => onUpdate(selected.id, { label: event.target.value })} />
        </label>
        <label className="field-label">VALUE
          <input value={selected.value} onChange={(event) => onUpdate(selected.id, { value: event.target.value })} />
        </label>
        <div className="property-row"><span>Pins</span><strong>{selected.pins}</strong></div>
        <div className="property-row"><span>Position</span><strong>{selected.position[0].toFixed(1)}, {selected.position[2].toFixed(1)}</strong></div>
        <button className="delete-button" onClick={() => onDelete(selected.id)}><Trash2 size={14} /> Remove component</button>
      </div> : <div className="empty-inspector"><Box size={24} /><p>Select a component in the workspace to inspect its properties.</p></div>}
    </section>

    <section className="panel layers-panel">
      <div className="panel-title"><Layers3 size={15} /> Layers</div>
      <div className="layer-list">
        {layerMeta.map((layer) => <button key={layer.id} className={activeLayers[layer.id] ? 'active' : ''} onClick={() => onToggleLayer(layer.id)}>
          <span className="layer-dot" style={{ background: layer.color }} /><span>{layer.name}</span><span className="eye-dot" />
        </button>)}
      </div>
    </section>

    <section className="panel engine-panel">
      <div className="panel-title-row"><div className="panel-title"><Activity size={15} /> Engine</div><span className={`status-tag ${result.status}`}>{result.status}</span></div>
      <div className="metric-feature"><span>Output</span><strong>{result.voltageOut.toFixed(2)} <small>V</small></strong><div className="sparkline"><i /><i /><i /><i /><i /><i /><i /></div></div>
      <div className="metric-grid">
        <div><span>Current</span><strong>{result.current}<small> mA</small></strong></div>
        <div><span>Efficiency</span><strong>{result.efficiency}<small>%</small></strong></div>
        <div><span>Power</span><strong>{result.power}<small> W</small></strong></div>
        <div><span>Nodes</span><strong>{result.nodeCount}</strong></div>
      </div>
      <button className="engine-detail"><Zap size={14} /> Simulation report <ChevronRight size={14} /></button>
    </section>
  </div>
}
