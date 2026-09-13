// The things open on top of the screen that an Escape closes, newest last (useEscape, which
// explains the order); one listener on the document serves them all. Kept apart from
// useEscape so anything else that must stand aside while something is on top (the session
// tabs' switch chord) can ask without owning a closer.

const closers: (() => void)[] = [];

const onKey = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const top = closers.at(-1);
  if (top === undefined) return;
  event.preventDefault();
  top();
};

const register = (close: () => void): void => {
  if (closers.length === 0) document.addEventListener('keydown', onKey);
  closers.push(close);
};

const unregister = (close: () => void): void => {
  const at = closers.lastIndexOf(close);
  if (at >= 0) closers.splice(at, 1);
  if (closers.length === 0) document.removeEventListener('keydown', onKey);
};

// Whether anything is open on top: a modal, a sheet, a menu, the image overlay.
const open = (): boolean => closers.length > 0;

export const escapeStack: {
  register: typeof register;
  unregister: typeof unregister;
  open: typeof open;
} = { register, unregister, open };
