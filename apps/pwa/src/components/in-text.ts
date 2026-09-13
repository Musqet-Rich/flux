// Whether an event's target, or the focus, is somewhere text is typed: a textarea, an input or
// anything contentEditable. What a chord means there is judged by the switch chord and the
// focus chord alike.
export const inText = (target: EventTarget | Element | null): boolean =>
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLInputElement ||
  (target instanceof HTMLElement && target.isContentEditable);
