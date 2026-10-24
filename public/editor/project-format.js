(function(root) {
  'use strict';
  const types = new Set(['resistor', 'led', 'battery', 'buzzer', 'button', 'esp32']);
  const rows = new Set(['a','b','c','d','e','f','g','h','i','j','tp','tn','bn','bp']);
  function hole(value) {
    if (!value || !rows.has(value.row) || !Number.isInteger(value.col) || value.col < 0 || value.col >= 50) throw new Error('Invalid breadboard socket.');
    return { row: value.row, col: value.col };
  }
  function validate(data) {
    if (!data || typeof data !== 'object' || (data.version !== undefined && data.version !== 1)) throw new Error('Unsupported circuit file version.');
    if (!Array.isArray(data.components) || data.components.length > 300 || !Array.isArray(data.wires) || data.wires.length > 1000) throw new Error('Circuit files support at most 300 components and 1,000 wires.');
    if (data.name !== undefined && (typeof data.name !== 'string' || data.name.length > 200)) throw new Error('Invalid circuit name.');
    const components = data.components.map(c => {
      if (!c || !types.has(c.type)) throw new Error('Unsupported circuit component.');
      const result = { type: c.type, holeRefs: null, position: null };
      if (c.type === 'battery') {
        if (!c.position || !Number.isFinite(c.position.x) || !Number.isFinite(c.position.z) || Math.abs(c.position.x) > 1000 || Math.abs(c.position.z) > 1000) throw new Error('Invalid battery position.');
        result.position = { x: c.position.x, z: c.position.z };
      } else {
        const sockets = c.type === 'esp32' ? 30 : 2;
        if (!Array.isArray(c.holeRefs) || c.holeRefs.length !== sockets) throw new Error(sockets === 2 ? 'Components need two socket connections.' : 'An ESP32 needs 30 socket connections.');
        result.holeRefs = c.holeRefs.map(hole);
      }
      if (c.resistance !== undefined) {
        if (!Number.isFinite(c.resistance) || c.resistance <= 0 || c.resistance > 1e9) throw new Error('Invalid resistance.');
        result.resistance = c.resistance;
      }
      if (c.values !== undefined) {
        if (!c.values || typeof c.values !== 'object' || Array.isArray(c.values)) throw new Error('Invalid component values.');
        result.values = {};
        for (const key of ['resistance', 'voltage', 'forwardVoltage', 'thresholdCurrent', 'maxCurrent', 'internalResistance', 'frequency', 'ideality', 'ratedCurrent']) {
          if (c.values[key] === undefined) continue;
          if (!Number.isFinite(c.values[key]) || c.values[key] <= 0 || c.values[key] > 1e9) throw new Error('Invalid electrical value.');
          result.values[key] = c.values[key];
        }
        if (c.values.color !== undefined) {
          if (!['red','yellow','green','blue','white'].includes(c.values.color)) throw new Error('Invalid LED color.');
          result.values.color = c.values.color;
        }
      } else if (c.resistance !== undefined) {
        result.values = { resistance: c.resistance };
      }
      return result;
    });
    const wires = data.wires.map(w => {
      if (!w || typeof w !== 'object') throw new Error('Invalid wire.');
      const result = {};
      for (const side of ['start', 'end']) {
        if (w[side + 'Hole']) {
          result[side + 'Hole'] = hole(w[side + 'Hole']);
          result[side + 'CompIdx'] = -1;
          result[side + 'PinIdx'] = -1;
        } else {
          const index = w[side + 'CompIdx'], pin = w[side + 'PinIdx'];
          if (!Number.isInteger(index) || index < 0 || index >= components.length || ![0, 1].includes(pin)) throw new Error('Wire references a missing component pin.');
          result[side + 'Hole'] = null;
          result[side + 'CompIdx'] = index;
          result[side + 'PinIdx'] = pin;
        }
      }
      if (w.color !== undefined && (!Number.isInteger(w.color) || w.color < 0 || w.color > 0xffffff)) throw new Error('Invalid wire color.');
      result.color = w.color ?? 0xef4444;
      return result;
    });
    const result = { version: 1, name: data.name || 'Untitled', components, wires };
    if (typeof data.id === 'string' && data.id.length <= 120) result.id = data.id;
    if (typeof data.thumbnail === 'string' && /^data:image\/(jpeg|png);base64,/.test(data.thumbnail) && data.thumbnail.length <= 2e6) result.thumbnail = data.thumbnail;
    return result;
  }
  root.WorkbenchFiles = { validate };
})(globalThis);
