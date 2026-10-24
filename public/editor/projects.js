(function(App) {
  const EXAMPLES = [
    { name: 'LED workbench', detail: 'A battery, resistor and LED', file: '/editor/demo.surge' },
    { name: 'ESP32 blink', detail: 'An ESP32 blinking an LED, with its sketch', file: '/editor/demo_esp32.surge' },
  ];
  const dialog = document.createElement('dialog');
  dialog.className = 'project-dialog';
  document.body.append(dialog);
  App.openProjects = function() {
    dialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Open a circuit';
    dialog.append(heading);
    const list = document.createElement('div');
    list.className = 'project-list';
    const examples = document.createElement('div');
    examples.className = 'project-list';
    for (const example of EXAMPLES) {
      const button = document.createElement('button');
      button.className = 'saved-project';
      const title = document.createElement('strong');
      title.textContent = example.name;
      const detail = document.createElement('span');
      detail.textContent = example.detail;
      button.append(title, detail);
      button.onclick = () => {
        fetch(example.file).then(r => r.json()).then(data => {
          delete data.id;
          App.loadCircuitData(data);
          dialog.close();
        }).catch(() => App.setHint('Could not load the example', 3000));
      };
      examples.append(button);
    }
    dialog.append(examples);
    let projects = [];
    try { projects = JSON.parse(localStorage.getItem('surge_local_projects') || '[]'); } catch {}
    if (!Array.isArray(projects)) projects = [];
    for (const project of projects.slice(0, 30)) {
      const button = document.createElement('button');
      button.className = 'saved-project';
      const title = document.createElement('strong');
      title.textContent = project.name || 'Untitled';
      const detail = document.createElement('span');
      detail.textContent = (project.components?.length || 0) + ' components · ' + (project.wires?.length || 0) + ' wires';
      button.append(title, detail);
      button.onclick = () => {
        try { App.loadCircuitData(WorkbenchFiles.validate(project)); dialog.close(); }
        catch (error) { App.setHint(error.message, 4000); }
      };
      list.append(button);
    }
    if (!projects.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Circuits you build are saved automatically in this browser.';
      list.append(empty);
    }
    dialog.append(list);
    const actions = document.createElement('div');
    actions.className = 'project-dialog-actions';
    const file = document.createElement('button');
    file.className = 'btn-secondary';
    file.textContent = 'Open file…';
    file.onclick = () => { dialog.close(); App.loadCircuit(); };
    const close = document.createElement('button');
    close.className = 'btn-secondary';
    close.textContent = 'Cancel';
    close.onclick = () => dialog.close();
    actions.append(file, close);
    dialog.append(actions);
    if (!dialog.open) dialog.showModal();
  };
})(window.App);
