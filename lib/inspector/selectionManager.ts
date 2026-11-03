export interface SelectionState {
  selectedId: string | null;
  isDragging: boolean;
  capturedPointerId: number | null;
}

export const INITIAL_SELECTION_STATE: SelectionState = {
  selectedId: null,
  isDragging: false,
  capturedPointerId: null,
};

export type SelectionAction =
  | { type: "SELECT"; id: string; pointerId?: number }
  | { type: "DESELECT" }
  | { type: "DRAG_START"; pointerId?: number }
  | { type: "DRAG_END" }
  | { type: "POINTER_LOST" };

/**
 * Pure state machine managing inspector selection and pointer capture transitions.
 * Guarantees idempotency (re-selecting the same element never triggers redundant unmount/mount)
 * and fail-safe recovery on lost pointer capture (resetting stuck drag states).
 */
export function selectionReducer(
  state: SelectionState,
  action: SelectionAction,
): SelectionState {
  switch (action.type) {
    case "SELECT":
      if (state.selectedId === action.id && state.capturedPointerId === (action.pointerId ?? state.capturedPointerId)) {
        return state;
      }
      return {
        ...state,
        selectedId: action.id,
        capturedPointerId: action.pointerId ?? state.capturedPointerId,
      };
    case "DESELECT":
      return {
        selectedId: null,
        isDragging: false,
        capturedPointerId: null,
      };
    case "DRAG_START":
      return {
        ...state,
        isDragging: true,
        capturedPointerId: action.pointerId ?? state.capturedPointerId,
      };
    case "DRAG_END":
    case "POINTER_LOST":
      return {
        ...state,
        isDragging: false,
        capturedPointerId: null,
      };
    default:
      return state;
  }
}
