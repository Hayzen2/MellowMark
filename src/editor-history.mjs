export function createEditorHistory(limit = 200) {
  const documents = new Map();

  function stateFor(id) {
    let state = documents.get(id);
    if (!state) {
      state = { undo: [], redo: [], lastEdit: null };
      documents.set(id, state);
    }
    return state;
  }

  return {
    record(id, before, after, inputType, timestamp = Date.now()) {
      if (before.content === after.content) return;
      const state = stateFor(id);
      const previous = state.lastEdit;
      const contiguous =
        previous &&
        previous.inputType === inputType &&
        timestamp - previous.timestamp < 850 &&
        before.selectionStart === before.selectionEnd &&
        after.selectionStart === after.selectionEnd &&
        before.selectionStart === previous.selectionStart;

      if (!contiguous) {
        state.undo.push(before);
        if (state.undo.length > limit) state.undo.shift();
      }
      state.redo.length = 0;
      state.lastEdit = {
        inputType,
        timestamp,
        selectionStart: after.selectionStart,
      };
    },

    undo(id, current) {
      const state = documents.get(id);
      if (!state?.undo.length) return null;
      state.redo.push(current);
      state.lastEdit = null;
      return state.undo.pop();
    },

    redo(id, current) {
      const state = documents.get(id);
      if (!state?.redo.length) return null;
      state.undo.push(current);
      state.lastEdit = null;
      return state.redo.pop();
    },
  };
}
