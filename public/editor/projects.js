(function(App) {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-dialog';
  document.body.append(dialog);
  App.openProjects = function() {
    App.flushAutoSave();
    dialog.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Open a circuit';
    dialog.append(heading);
    const list = document.createElement('div');
    list.className = 'project-list';
    let projects = [];
    try { projects = JSON.parse(localStorage.getItem('surge_local_projects') || '[]'); } catch {}
    if (!Array.isArray(projects)) projects = [];
    for (const project of projects.slice(0, 30)) {
      const button = document.createElement('button');
      button.className = 'saved-project';
      if (typeof project.thumbnail === 'string' && /^data:image\/(jpeg|png);base64,/.test(project.thumbnail)) {
        const preview = document.createElement('img');
        preview.className = 'saved-project-preview';
        preview.src = project.thumbnail;
        preview.alt = '';
        preview.draggable = false;
        preview.onerror = () => preview.remove();
        button.append(preview);
      }
      const title = document.createElement('strong');
      title.textContent = project.name || 'Untitled';
      button.append(title);
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
